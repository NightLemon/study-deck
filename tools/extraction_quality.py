"""Independent PDF reading-order checks and release gates for extracted packs."""
from __future__ import annotations

import re
import hashlib
from collections import Counter

from pack_extractor import (CHAPTER_RE, SECTION_RE, MARKER_PATTERNS,
                            is_noise_line, normalize_id, normalize_text)

FIELDS = ("prompt", "interpretation", "knowledge", "answer", "extension")


def compact(value: str) -> str:
    return re.sub(r"\s+", "", normalize_text(value))


def canonical_content(value: str, prompt: bool = False) -> str:
    """Ignore Markdown delimiters, list markers and layout whitespace only."""
    lines = []
    in_code = False
    for line in value.splitlines():
        line = normalize_text(line)
        if line.startswith("```"):
            in_code = not in_code
            continue
        if not in_code:
            line = re.sub(r"\\([<>\[\]_])", r"\1", line)
        if not prompt:
            line = re.sub(r"^(?:[。·•-]\s*|[.o](?:\s+|$))", "", line)
            line = re.sub(r"^(\d+)、", r"\1.", line)
        lines.append(line)
    return compact("".join(lines))


def independent_fields(reader, pages, expected_ids: set[str], mode: str = "layout") -> dict[str, dict[str, str]]:
    """Use pypdf's separate layout engine; never reuse our reconstructed lines."""
    hierarchy = {compact(line.text) for lines in pages.values() for line in lines
                 if line.size >= 14 and (CHAPTER_RE.match(line.text) or SECTION_RE.match(line.text))}
    result = {}
    current_id = None
    field = "prompt"
    found = set()
    heading = re.compile(r"^(\d{1,2}\.\s*\d{1,2}\.\s*\d{1,2})(?!\d)(.*)$")
    for number in sorted(pages):
        text = reader.pages[number - 1].extract_text(extraction_mode=mode) or ""
        plain_bullets = None
        for raw in text.splitlines():
            line = normalize_text(raw)
            if not line or is_noise_line(line) or compact(line) in hierarchy:
                continue
            # pypdf layout may glue an 'o' bullet to an English word. Confirm
            # its role with the independent content-stream text before removing it.
            if line[0] in ".o" and not line.startswith(("o ", ". ")):
                if plain_bullets is None:
                    plain = reader.pages[number - 1].extract_text() or ""
                    plain_bullets = {compact(s) for s in plain.splitlines() if re.match(r"^\s*[.o]\s+", s)}
                if compact(line) in plain_bullets:
                    line = line[0] + " " + line[1:]
            match = heading.match(line)
            if match and normalize_id(match[1]) in expected_ids:
                current_id = normalize_id(match[1])
                if current_id in result:
                    raise ValueError(f"独立抽取出现重复题号: {current_id}")
                result[current_id] = {name: "" for name in FIELDS}
                field = "prompt"
                found = set()
                line = match[2].strip()
            if current_id is None:
                continue
            for name, pattern in MARKER_PATTERNS.items():
                marker = pattern.fullmatch(line)
                if marker and not marker[1] and name not in found:
                    found.add(name)
                    field = name
                    line = ""
                    break
            if line:
                result[current_id][field] += line + "\n"
        if number % 100 == 0:
            print(f"independent verification: {number}/{len(reader.pages)}", flush=True)
    return result


def compare_reference(questions: list[dict], reference: dict) -> dict:
    prompt_mismatches, inventory_mismatches, order_mismatches = [], [], []
    for question in questions:
        qid = question["id"]
        if qid not in reference:
            prompt_mismatches.append({"id": qid, "reason": "independent heading missing"})
            continue
        for field in FIELDS:
            actual = canonical_content(question["original"][field], field == "prompt")
            expected = canonical_content(reference[qid][field], field == "prompt")
            if actual == expected:
                continue
            if field == "prompt":
                prompt_mismatches.append({"id": qid, "expected": expected, "actual": actual})
            missing = Counter(expected) - Counter(actual)
            extra = Counter(actual) - Counter(expected)
            detail = {"id": qid, "field": field, "missing": dict(missing), "extra": dict(extra)}
            if missing or extra:
                inventory_mismatches.append(detail)
            else:
                order_mismatches.append({"id": qid, "field": field})
    return {"engine": "pypdf-layout", "questionCount": len(reference),
            "promptMismatches": prompt_mismatches,
            "characterMismatches": inventory_mismatches,
            "readingOrderMismatches": order_mismatches}


def verify_fidelity(reader, pages, questions: list[dict], expected_ids: set[str]) -> dict:
    reference = independent_fields(reader, pages, expected_ids)
    report = compare_reference(questions, reference)
    confirmations = []
    # pypdf layout occasionally merges very close code baselines. A match in
    # its independent content-stream order can resolve ordering-only differences;
    # it cannot waive missing or added characters.
    for mismatch in list(report["readingOrderMismatches"]):
        qid, field = mismatch["id"], mismatch["field"]
        question = next(q for q in questions if q["id"] == qid)
        selected = {n: pages[n] for n in range(question["sourcePages"][0], question["sourcePages"][1] + 1)}
        fallback = independent_fields(reader, selected, {qid}, mode="plain")
        if canonical_content(fallback.get(qid, {}).get(field, "")) == canonical_content(question["original"][field]):
            report["readingOrderMismatches"].remove(mismatch)
            confirmations.append({**mismatch, "engine": "pypdf-content-stream"})
    report["contentStreamConfirmations"] = confirmations
    report["checkedFieldCount"] = len(questions) * len(FIELDS)
    return report


def assert_release_quality(report: dict, expected_ids: set[str], questions: list[dict], source_issues: dict) -> None:
    actual_ids = {q["id"] for q in questions}
    if actual_ids != expected_ids:
        raise ValueError(f"目录/正文题号不一致: missing={sorted(expected_ids - actual_ids)}, extra={sorted(actual_ids - expected_ids)}")
    unexpected = []
    for field, ids in report["emptyFields"].items():
        for qid in ids:
            if field not in source_issues.get(qid, {}).get("missingFields", []):
                unexpected.append(f"{qid}.{field}")
    if unexpected:
        raise ValueError(f"未登记的空字段: {unexpected}")
    for issue in report["issues"]:
        qid = issue.split(":", 1)[0]
        if "重复字段" in issue and not source_issues.get(qid, {}).get("repeatedMarkers"):
            raise ValueError(issue)
    fidelity = report["fidelity"]
    if any(fidelity[key] for key in ("promptMismatches", "characterMismatches", "readingOrderMismatches")):
        raise ValueError("独立原文比对失败; 请先检查 extraction-audit.json，不得发布题库")
    for question in questions:
        for field, value in question["original"].items():
            if len(re.findall(r"(?m)^```\w*\s*$", value)) % 2:
                raise ValueError(f"代码围栏未闭合: {question['id']}.{field}")
            if "\ufffd" in value:
                raise ValueError(f"抽取包含 Unicode 替换字符: {question['id']}.{field}")


def raw_digest(content_root) -> str:
    digest = hashlib.sha256()
    for path in sorted((content_root / "raw").glob("chapter-*.json")):
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()
