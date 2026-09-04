#!/usr/bin/env python3
"""Extract the known four-part Q&A layout into immutable per-chapter JSON.

The extractor is content-agnostic. It uses body question headings as the source
of truth, outline entries for chapter metadata, and Courier font information as
an additional signal for fenced code blocks.
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import pdfplumber
from pypdf import PdfReader

QUESTION_RE = re.compile(r"^(\d{1,2}\.\s*\d{1,2}\.\s*\d{1,2})(?:\s+(.+))?$")
CHAPTER_RE = re.compile(r"^(\d+)\s+(.+)$")
SECTION_RE = re.compile(r"^(\d+\.\d+)\s+(.+)$")
HIERARCHY_ID_RE = re.compile(r"^\d+(?:\.\d+)?$")
HEADER_RE = re.compile(r"^第\s*\d+\s*页\s*/\s*共\s*\d+\s*页$")
MARKER_PATTERNS = {
    "interpretation": re.compile(r"^题\s*目\s*解\s*读\s*[:：]?\s*(.*)$"),
    "knowledge": re.compile(r"^知\s*识\s*点\s*[:：]?\s*(.*)$"),
    "answer": re.compile(r"^答\s*案\s*[:：]?\s*(.*)$"),
    "extension": re.compile(r"^拓\s*展\s*思\s*考\s*[:：]?\s*(.*)$"),
}


@dataclass(frozen=True)
class TextLine:
    text: str
    code: bool = False


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).replace("\x00", "")
    value = value.replace("\u00a0", " ").replace("\ufeff", "")
    value = re.sub(r"[ \t]+", " ", value)
    return value.strip()


def normalize_id(value: str) -> str:
    return re.sub(r"\s+", "", value)


def is_noise_line(value: str) -> bool:
    value = normalize_text(value)
    return bool(HEADER_RE.match(value) or re.match(r"^创脉思\s*\(cms365\.cn\)", value))


def outline_rows(reader: PdfReader) -> list[tuple[int, str, int | None]]:
    rows: list[tuple[int, str, int | None]] = []

    def walk(items: Iterable[object], depth: int = 0) -> None:
        for item in items:
            if isinstance(item, list):
                walk(item, depth + 1)
                continue
            title = normalize_text(getattr(item, "title", str(item)).replace("\n", " "))
            try:
                page = reader.get_destination_page_number(item) + 1
            except Exception:
                page = None
            rows.append((depth, title, page))

    walk(reader.outline)
    return rows


def extract_hierarchy(reader: PdfReader) -> list[dict]:
    chapters: dict[str, dict] = {}
    for depth, title, _page in outline_rows(reader):
        if depth == 0:
            match = CHAPTER_RE.match(title)
            if match:
                chapter_id, chapter_title = match.groups()
                chapters[chapter_id] = {
                    "id": chapter_id,
                    "title": chapter_title.strip(),
                    "order": int(chapter_id),
                    "sections": [],
                }
        elif depth == 1:
            match = SECTION_RE.match(title)
            if not match:
                continue
            section_id, section_title = match.groups()
            chapter_id = section_id.split(".", 1)[0]
            if chapter_id in chapters:
                chapters[chapter_id]["sections"].append(
                    {
                        "id": section_id,
                        "title": section_title.strip(),
                        "order": int(section_id.split(".")[1]),
                    }
                )
    return sorted(chapters.values(), key=lambda item: item["order"])


def code_line_numbers(pdf_path: Path, page_numbers: set[int]) -> dict[int, set[str]]:
    """Return normalized full-line Courier runs for the selected pages."""
    result: dict[int, set[str]] = defaultdict(set)
    with pdfplumber.open(pdf_path) as pdf:
        for page_number in sorted(page_numbers):
            page = pdf.pages[page_number - 1]
            words = page.extract_words(extra_attrs=["fontname", "size"], keep_blank_chars=False)
            grouped: dict[int, list[dict]] = defaultdict(list)
            for word in words:
                grouped[round(float(word["top"]) / 2)].append(word)
            for row in grouped.values():
                row.sort(key=lambda item: float(item["x0"]))
                all_chars = sum(len(str(item["text"])) for item in row)
                mono_chars = sum(
                    len(str(item["text"]))
                    for item in row
                    if any(token in str(item["fontname"]).lower() for token in ("courier", "mono", "consol"))
                )
                text = normalize_text(" ".join(str(item["text"]) for item in row))
                if all_chars >= 8 and mono_chars / max(all_chars, 1) >= 0.68:
                    result[page_number].add(re.sub(r"\s+", "", text))
            if page_number % 250 == 0:
                print(f"layout scan: {page_number}/{len(pdf.pages)}", flush=True)
    return result


def visual_page_lines(pdf_path: Path, start_page: int) -> dict[int, list[TextLine]]:
    """Extract lines in visual top-to-bottom order and retain font-based code hints."""
    pages: dict[int, list[TextLine]] = {}
    with pdfplumber.open(pdf_path) as pdf:
        for page_number in range(start_page, len(pdf.pages) + 1):
            page = pdf.pages[page_number - 1]
            words = page.extract_words(
                extra_attrs=["fontname", "size"],
                keep_blank_chars=False,
                use_text_flow=False,
            )
            grouped: dict[int, list[dict]] = defaultdict(list)
            for word in words:
                grouped[round(float(word["top"]) / 2)].append(word)

            lines: list[TextLine] = []
            for row_key in sorted(grouped):
                row = sorted(grouped[row_key], key=lambda item: float(item["x0"]))
                text = normalize_text(" ".join(str(item["text"]) for item in row))
                if not text or is_noise_line(text):
                    continue
                all_chars = sum(len(str(item["text"])) for item in row)
                mono_chars = sum(
                    len(str(item["text"]))
                    for item in row
                    if any(token in str(item["fontname"]).lower() for token in ("courier", "mono", "consol"))
                )
                lines.append(TextLine(text=text, code=all_chars >= 8 and mono_chars / max(all_chars, 1) >= 0.68))
            pages[page_number] = lines
            if page_number % 250 == 0:
                print(f"visual scan: {page_number}/{len(pdf.pages)}", flush=True)
    return pages


def page_lines(reader: PdfReader, start_page: int, code_signals: dict[int, set[str]]) -> dict[int, list[TextLine]]:
    pages: dict[int, list[TextLine]] = {}
    for page_number in range(start_page, len(reader.pages) + 1):
        text = reader.pages[page_number - 1].extract_text() or ""
        lines: list[TextLine] = []
        signals = code_signals.get(page_number, set())
        for raw in text.splitlines():
            cleaned = normalize_text(raw)
            if not cleaned or is_noise_line(cleaned):
                continue
            compact = re.sub(r"\s+", "", cleaned)
            code = any(len(signal) >= 8 and (signal in compact or compact in signal) for signal in signals)
            lines.append(TextLine(cleaned, code))
        pages[page_number] = lines
        if page_number % 250 == 0:
            print(f"text scan: {page_number}/{len(reader.pages)}", flush=True)
    return pages


def find_question_starts(
    pages: dict[int, list[TextLine]], allowed_ids: set[str] | None = None
) -> list[tuple[str, int, int]]:
    starts: list[tuple[str, int, int]] = []
    seen: set[str] = set()
    for page_number, lines in pages.items():
        for line_index, line in enumerate(lines):
            match = QUESTION_RE.match(line.text)
            if not match:
                continue
            question_id = normalize_id(match.group(1))
            if allowed_ids is not None and question_id not in allowed_ids:
                continue
            if question_id in seen:
                raise ValueError(f"正文出现重复题号: {question_id}")
            seen.add(question_id)
            starts.append((question_id, page_number, line_index))
            break
    return starts


def toc_question_ids(reader: PdfReader, body_start_page: int) -> set[str]:
    ids: set[str] = set()
    for page in reader.pages[1 : body_start_page - 1]:
        text = unicodedata.normalize("NFKC", page.extract_text() or "")
        for match in re.finditer(r"(?m)^(\d{1,2}\.\s*\d{1,2}\.\s*\d{1,2})(?=\s)", text):
            ids.add(normalize_id(match.group(1)))
    return ids


def markdownize(lines: list[TextLine]) -> str:
    output: list[str] = []
    in_code = False
    for item in lines:
        text = item.text.strip()
        if item.code and not in_code:
            if output and output[-1] != "":
                output.append("")
            output.append("```cpp")
            in_code = True
        elif not item.code and in_code:
            output.extend(["```", ""])
            in_code = False

        if item.code:
            output.append(text)
            continue

        text = re.sub(r"^[。·•]\s*", "- ", text)
        text = re.sub(r"^(\d+)[、.]\s*", r"\1. ", text)
        output.append(text)

    if in_code:
        output.append("```")
    return "\n".join(output).strip()


def split_fields(question_id: str, lines: list[TextLine]) -> tuple[dict, list[str]]:
    issues: list[str] = []
    id_index = next(
        (
            index
            for index, line in enumerate(lines)
            if (match := QUESTION_RE.match(line.text)) and normalize_id(match.group(1)) == question_id
        ),
        None,
    )
    if id_index is None:
        raise ValueError(f"题目 {question_id} 起始行无法解析")
    id_match = QUESTION_RE.match(lines[id_index].text)
    assert id_match is not None
    prompt_first = (id_match.group(2) or "").strip()
    working = list(lines[:id_index])
    if prompt_first:
        working.append(TextLine(prompt_first, lines[id_index].code))
    working.extend(lines[id_index + 1 :])
    buckets: dict[str, list[TextLine]] = {name: [] for name in ("prompt", *MARKER_PATTERNS)}
    current = "prompt"
    found: set[str] = set()
    for item in working:
        if item.text in (":", "：") and current != "prompt" and not buckets[current]:
            continue
        matched = False
        for name, pattern in MARKER_PATTERNS.items():
            marker = pattern.match(item.text)
            if marker:
                current = name
                found.add(name)
                trailing = marker.group(1).strip()
                if trailing:
                    buckets[current].append(TextLine(trailing, item.code))
                matched = True
                break
        if not matched:
            buckets[current].append(item)

    for marker in MARKER_PATTERNS:
        if marker not in found:
            issues.append(f"{question_id}: 缺少字段标记 {marker}")

    fields = {name: markdownize(bucket) for name, bucket in buckets.items()}
    if not fields["prompt"]:
        issues.append(f"{question_id}: 题目为空")
    return fields, issues


def extract_questions(
    pages: dict[int, list[TextLine]], starts: list[tuple[str, int, int]]
) -> tuple[list[dict], list[str]]:
    questions: list[dict] = []
    issues: list[str] = []
    last_page = max(pages)
    for order, (question_id, start_page, line_index) in enumerate(starts, 1):
        end_page = starts[order][1] - 1 if order < len(starts) else last_page
        combined: list[TextLine] = []
        start_line = line_index
        start_match = QUESTION_RE.match(pages[start_page][line_index].text)
        if start_match and not start_match.group(2):
            start_line = max(0, line_index - 4)
            for candidate in range(line_index - 1, -1, -1):
                text = pages[start_page][candidate].text
                if CHAPTER_RE.match(text) or SECTION_RE.match(text) or HIERARCHY_ID_RE.match(text):
                    start_line = candidate + 1
                    break
        for page_number in range(start_page, end_page + 1):
            page = pages[page_number]
            combined.extend(page[start_line if page_number == start_page else 0 :])
        fields, field_issues = split_fields(question_id, combined)
        issues.extend(field_issues)
        chapter_id, section_number, _ = question_id.split(".")
        questions.append(
            {
                "id": question_id,
                "chapterId": chapter_id,
                "sectionId": f"{chapter_id}.{section_number}",
                "order": order,
                "sourcePages": [start_page, end_page],
                "original": fields,
                "review": {"status": "raw"},
            }
        )
    return questions, issues


def reconcile_hierarchy(chapters: list[dict], questions: list[dict], pages: dict[int, list[TextLine]]) -> list[dict]:
    """Keep only sections used by questions and recover missing titles from body headings."""
    used_sections = {question["sectionId"] for question in questions}
    body_titles: dict[str, str] = {}
    for lines in pages.values():
        for line in lines:
            match = SECTION_RE.match(line.text)
            if match and match.group(1) in used_sections:
                body_titles.setdefault(match.group(1), match.group(2).strip())

    for chapter in chapters:
        existing = {section["id"]: section for section in chapter["sections"] if section["id"] in used_sections}
        chapter_sections = sorted(
            (section_id for section_id in used_sections if section_id.split(".", 1)[0] == chapter["id"]),
            key=lambda value: tuple(map(int, value.split("."))),
        )
        chapter["sections"] = [
            existing.get(
                section_id,
                {
                    "id": section_id,
                    "title": body_titles.get(section_id, f"第 {section_id} 节"),
                    "order": int(section_id.split(".")[1]),
                },
            )
            for section_id in chapter_sections
        ]
    return chapters


def audit(chapters: list[dict], questions: list[dict], issues: list[str], page_count: int) -> dict:
    section_ids = {section["id"] for chapter in chapters for section in chapter["sections"]}
    ids = [question["id"] for question in questions]
    unknown_sections = [question["id"] for question in questions if question["sectionId"] not in section_ids]
    empty_fields = {
        key: [question["id"] for question in questions if not question["original"][key]]
        for key in ("prompt", "interpretation", "knowledge", "answer", "extension")
    }
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "pageCount": page_count,
        "chapterCount": len(chapters),
        "sectionCount": len(section_ids),
        "questionCount": len(questions),
        "uniqueQuestionCount": len(set(ids)),
        "firstQuestion": ids[0] if ids else None,
        "lastQuestion": ids[-1] if ids else None,
        "unknownSectionQuestions": unknown_sections,
        "emptyFields": empty_fields,
        "issues": issues,
    }


def write_outputs(content_root: Path, chapters: list[dict], questions: list[dict], report: dict) -> None:
    raw_dir = content_root / "raw"
    revision_dir = content_root / "revisions"
    report_dir = content_root / "reports"
    for directory in (raw_dir, revision_dir, report_dir):
        directory.mkdir(parents=True, exist_ok=True)

    grouped: dict[str, list[dict]] = defaultdict(list)
    for question in questions:
        grouped[question["chapterId"]].append(question)

    for chapter in chapters:
        chapter_id = chapter["id"]
        raw_path = raw_dir / f"chapter-{int(chapter_id):02d}.json"
        raw_path.write_text(
            json.dumps({"chapter": chapter, "questions": grouped[chapter_id]}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        revision_path = revision_dir / f"chapter-{int(chapter_id):02d}.json"
        if not revision_path.exists():
            revision_path.write_text(
                json.dumps({"chapterId": chapter_id, "questions": {}}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

    (report_dir / "extraction-audit.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--content-root", required=True, type=Path)
    parser.add_argument("--body-start-page", type=int, default=56)
    parser.add_argument("--expected-questions", type=int, default=963)
    parser.add_argument("--expected-chapters", type=int, default=23)
    parser.add_argument("--expected-sections", type=int, default=164)
    parser.add_argument("--skip-layout", action="store_true", help="Skip Courier font inspection")
    args = parser.parse_args()

    reader = PdfReader(args.pdf)
    chapters = extract_hierarchy(reader)
    outline_section_ids = {section["id"] for chapter in chapters for section in chapter["sections"]}
    if args.skip_layout:
        pages = page_lines(reader, args.body_start_page, {})
    else:
        pages = visual_page_lines(args.pdf, args.body_start_page)
    expected_ids = toc_question_ids(reader, args.body_start_page)
    starts = find_question_starts(pages, expected_ids)
    questions, issues = extract_questions(pages, starts)
    used_section_ids = {question["sectionId"] for question in questions}
    for missing_section in sorted(used_section_ids - outline_section_ids):
        issues.append(f"目录书签缺少正文小节 {missing_section}，已从正文恢复")
    for unused_section in sorted(outline_section_ids - used_section_ids):
        issues.append(f"目录书签小节 {unused_section} 没有对应正文题目，已忽略")
    chapters = reconcile_hierarchy(chapters, questions, pages)
    report = audit(chapters, questions, issues, len(reader.pages))

    body_ids = {question["id"] for question in questions}
    if expected_ids != body_ids:
        print(f"missing body ids: {sorted(expected_ids - body_ids)}", flush=True)
        print(f"unexpected body ids: {sorted(body_ids - expected_ids)}", flush=True)

    expected = (args.expected_chapters, args.expected_sections, args.expected_questions)
    actual = (report["chapterCount"], report["sectionCount"], report["questionCount"])
    if actual != expected:
        raise SystemExit(f"结构数量不符合预期: expected={expected}, actual={actual}")
    if report["uniqueQuestionCount"] != args.expected_questions or report["unknownSectionQuestions"]:
        print(f"unique questions: {report['uniqueQuestionCount']}", flush=True)
        print(f"unknown sections: {report['unknownSectionQuestions']}", flush=True)
        raise SystemExit("题号唯一性或章节引用校验失败")

    write_outputs(args.content_root, chapters, questions, report)
    print(json.dumps({key: report[key] for key in ("pageCount", "chapterCount", "sectionCount", "questionCount")}, ensure_ascii=False))
    print(f"field issues: {len(issues)}")


if __name__ == "__main__":
    main()
