#!/usr/bin/env python3
"""Extract the known four-part Q&A layout into immutable per-chapter JSON.

The extractor is content-agnostic. Glyph geometry determines reading order;
font sizes, code regions and literal Markdown determine structure. An independent
PDF engine checks every field before per-chapter files can be published.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Iterable

import pdfplumber
from pypdf import PdfReader

QUESTION_RE = re.compile(r"^(\d{1,2}\.\s*\d{1,2}\.\s*\d{1,2})(?:\s+(.+))?$")
CHAPTER_RE = re.compile(r"^(\d+)\s+(.+)$")
SECTION_RE = re.compile(r"^(\d+\.\d+)\s+(.+)$")
HIERARCHY_ID_RE = re.compile(r"^\d+(?:\.\d+)?$")
HEADER_RE = re.compile(r"^第\s*\d+\s*页\s*/\s*共\s*\d+\s*页$")
MARKER_PATTERNS = {
    "interpretation": re.compile(r"^(?:>\s*)?题\s*目\s*解\s*读\s*[:：]?\s*(.*)$"),
    "knowledge": re.compile(r"^(?:>\s*)?知\s*识\s*点\s*[:：]?\s*(.*)$"),
    "answer": re.compile(r"^(?:>\s*)?答\s*案\s*[:：]?\s*(.*)$"),
    "extension": re.compile(r"^(?:>\s*)?拓\s*展\s*思\s*考\s*[:：]?\s*(.*)$"),
}


@dataclass(frozen=True)
class TextLine:
    text: str
    code: bool = False
    x0: float = 0
    top: float = 0
    bottom: float = 0
    size: float = 0
    page: int = 0
    block: int | None = None
    bullet: str | None = None
    marker_x0: float | None = None


def normalize_text(value: str) -> str:
    # Compatibility folding must not turn mathematical exponents/subscripts
    # into ordinary digits. NFC still composes combining sequences afterwards.
    value = "".join(c if unicodedata.decomposition(c).startswith(("<super>", "<sub>"))
                    else unicodedata.normalize("NFKC", c) for c in value)
    value = unicodedata.normalize("NFC", value).replace("\x00", "")
    # These CJK radical glyphs have no NFKC mapping, unlike Kangxi radicals.
    value = value.translate(str.maketrans("⻅⻛⻬⻓⻆⻔⻉⻋⻢⻨⻩⻰⻳", "见风齐长角门贝车马麦黄龙龟"))
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


def is_monospace(char: dict) -> bool:
    return any(token in char["fontname"].lower() for token in ("courier", "mono", "consol"))


def cluster_rows(chars: list[dict]) -> list[list[dict]]:
    """Group overlapping glyph boxes, never rounded absolute top coordinates.

    CJK and Latin baselines differ by ~1pt; inline Courier differs by ~5pt.
    Compare against a stable row anchor to avoid chaining adjacent code lines.
    """
    rows: list[list[dict]] = []
    for char in sorted(chars, key=lambda c: (c["top"], c["x0"])):
        target = None
        best_overlap = 0.4
        for row in rows[-3:]:
            # A raised bullet is not the text baseline. Once a real glyph is
            # available, anchor on it so inline Courier still overlaps the row.
            anchor = next((c for c in row if c["text"].strip()
                           and c["text"] not in ".。·•o"), row[0])
            height = min(char["bottom"] - char["top"], anchor["bottom"] - anchor["top"])
            overlap = min(char["bottom"], anchor["bottom"]) - max(char["top"], anchor["top"])
            ratio = overlap / max(height, 0.01)
            if ratio > best_overlap:
                best_overlap, target = ratio, row
        if target is None:
            rows.append([char])
        else:
            target.append(char)
    return [sorted(row, key=lambda c: c["x0"]) for row in rows]


def row_text(row: list[dict], code: bool = False) -> str:
    """Keep real spaces and infer gaps only where the PDF omitted space glyphs."""
    text = ""
    previous = None
    for char in row:
        value = char["text"]
        if previous is not None and text and not text[-1].isspace() and not value.isspace():
            gap = char["x0"] - previous["x1"]
            if gap > min(char["size"], previous["size"]) * 0.18:
                spaces = max(1, round(gap / (char["size"] * 0.6))) if code else 1
                text += " " * spaces
        text += value
        previous = char
    if code:
        # Keep source spacing in strings and indentation; normalize glyphs only.
        return "".join(normalize_text(c) if not c.isspace() else c for c in text).strip()
    return normalize_text(text)


def layout_lines(page, page_number: int, graphics_audit: list[dict] | None = None) -> list[TextLine]:
    rows = cluster_rows(page.chars)
    # Code boxes can be raster backgrounds or vector rectangles. Require small
    # monospace text inside, so illustrations and inline identifiers stay prose.
    boxes = []
    for obj in page.images + page.rects + page.curves:
        if obj["width"] < 80 or obj["height"] < 15:
            continue
        inside = [c for c in page.chars if obj["x0"] <= c["x0"] <= obj["x1"]
                  and obj["top"] <= (c["top"] + c["bottom"]) / 2 <= obj["bottom"]]
        if any(is_monospace(c) and c["size"] < 11 for c in inside):
            boxes.append(obj)
    lines = []
    for row in rows:
        visible = [c for c in row if c["text"].strip()]
        if not visible:
            continue
        size = median(c["size"] for c in visible)
        top, bottom = min(c["top"] for c in visible), max(c["bottom"] for c in visible)
        block = next((i for i, box in enumerate(boxes)
                      if box["top"] <= (top + bottom) / 2 <= box["bottom"]
                      and box["x0"] - 1 <= visible[0]["x0"] <= box["x1"]), None)
        mono = [c for c in visible if is_monospace(c)]
        code = (block is not None and size < 11) or bool(mono and max(c["size"] for c in mono) < 11
                                        and (len(mono) / len(visible) >= 0.5 or row_text(row).startswith("//")))
        text = row_text(row, code)
        if not text or is_noise_line(text):
            continue
        lines.append(TextLine(text, code, visible[0]["x0"], top, bottom, size, page_number, block))
    return restore_graphical_lists(page, classify_document_blocks(lines), page_number, graphics_audit)


def restore_graphical_lists(page, lines: list[TextLine], page_number: int,
                            audit: list[dict] | None = None) -> list[TextLine]:
    """Map visible small marks to nearby prose; never invent off-page lists.

    Nested vector outlines share one centre and therefore represent one mark.
    Unmapped/ambiguous marks remain in the audit instead of guessing a row.
    """
    result = list(lines)
    seen: list[tuple[float, float]] = []
    shapes = [(o, "raster") for o in page.images]
    shapes += [(o, "vector") for o in page.rects + page.curves if o.get("fill")]
    for obj, kind in shapes:
        if not (2 <= obj["width"] <= 7 and 2 <= obj["height"] <= 7):
            continue
        cx, cy = (obj["x0"] + obj["x1"]) / 2, (obj["top"] + obj["bottom"]) / 2
        if any(abs(cx - x) < .1 and abs(cy - y) < .1 for x, y in seen):
            continue
        seen.append((cx, cy))
        record = {"page": page_number, "kind": kind,
                  "box": [obj["x0"], obj["top"], obj["x1"], obj["bottom"]]}
        visible = (obj["bottom"] > 0 and obj["top"] < getattr(page, "height", float("inf"))
                   and obj["x1"] > 0 and obj["x0"] < getattr(page, "width", float("inf")))
        candidates = sorted((abs((line.top + line.bottom) / 2 - cy), i)
                            for i, line in enumerate(lines)
                            if visible and not line.code and line.size < 14
                            and -.5 <= line.x0 - obj["x1"] < 20
                            and abs((line.top + line.bottom) / 2 - cy) < 8)
        if not visible:
            record["status"] = "off-page"
        elif not candidates:
            record["status"] = "unmapped"
        elif len(candidates) > 1 and candidates[1][0] - candidates[0][0] < 1:
            record["status"] = "ambiguous"
        else:
            _, index = candidates[0]
            line = result[index]
            record.update(status="mapped", text=line.text, top=line.top)
            if line.bullet is None:
                result[index] = replace(line, bullet=kind, marker_x0=obj["x0"])
        if audit is not None:
            audit.append(record)
    return result


def classify_document_blocks(lines: list[TextLine]) -> list[TextLine]:
    """Some PDF boxes contain an entire literal Markdown document, not code."""
    markdown_blocks = {line.block for line in lines if line.block is not None
                       and line.text.startswith(">")
                       and any(pattern.match(line.text) for pattern in MARKER_PATTERNS.values())}
    explicit_code = False
    result = []
    previous_block = None
    for line in lines:
        if line.block != previous_block:
            explicit_code = False
        code = line.code and line.size < 11
        if line.block in markdown_blocks:
            if line.text.startswith("```"):
                explicit_code = not explicit_code
                code = True
            else:
                code = explicit_code
        if any(pattern.fullmatch(line.text) and not pattern.fullmatch(line.text)[1]
               for pattern in MARKER_PATTERNS.values()):
            code = False
        result.append(replace(line, code=code))
        previous_block = line.block
    return result


def visual_page_lines(pdf_path: Path, start_page: int, end_page: int | None = None,
                      graphics_audit: list[dict] | None = None) -> dict[int, list[TextLine]]:
    pages: dict[int, list[TextLine]] = {}
    with pdfplumber.open(pdf_path) as pdf:
        for page_number in range(start_page, (end_page or len(pdf.pages)) + 1):
            page = pdf.pages[page_number - 1]
            pages[page_number] = layout_lines(page, page_number, graphics_audit)
            page.close()  # Do not retain thousands of decoded page objects.
            if page_number % 50 == 0:
                print(f"visual scan: {page_number}/{len(pdf.pages)}", flush=True)
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
    code_origin = 0.0
    previous: TextLine | None = None
    list_indent: list[float] = []
    for index, item in enumerate(lines):
        text = item.text.strip()
        if re.fullmatch(r"```\w*", text):
            continue  # Source fence; geometric runs emit one balanced pair.
        if item.code and not in_code:
            if output and output[-1] != "":
                output.append("")
            output.append("```cpp")
            in_code = True
            run = []
            for candidate in lines[index:]:
                if not candidate.code:
                    break
                run.append(candidate)
            code_origin = min(candidate.x0 for candidate in run)
        elif not item.code and in_code:
            output.extend(["```", ""])
            in_code = False

        if item.code:
            indent = max(0, round((item.x0 - code_origin) / max(item.size * 0.6, 1)))
            if (previous and previous.code and "//" in output[-1]
                    and item.x0 <= code_origin + 2
                    and re.match(r"(?:[\u4e00-\u9fff]|\d+\.[\u4e00-\u9fff])", text)):
                output[-1] = join_wrapped(output[-1], text)
                previous = item
                continue
            if previous and previous.code and item.page == previous.page and item.top - previous.bottom > item.size:
                output.append("")
            output.append(" " * indent + text)
            previous = item
            continue

        text = escape_prose(text)
        text = re.sub(r"^(?:[。·•]|[.o](?=\s))\s*", "- ", text)
        text = re.sub(r"^(\d+)[、.](?!\d)\s*", r"\1. ", text)
        is_list = bool(re.match(r"^(?:- |\d+\. )", text))
        if item.bullet and not is_list:
            text = "- " + text
            is_list = True
        if is_list:
            # CommonMark only lets an ordered list starting at 1 interrupt a
            # paragraph. Separate every new list block so later numbers and
            # their nested graphical bullets cannot become paragraph text.
            if output and output[-1] and not re.match(r"^\s*(?:- |\d+\. )", output[-1]):
                output.append("")
            marker_x = item.marker_x0 if item.marker_x0 is not None else item.x0
            while list_indent and marker_x < list_indent[-1] - 8:
                list_indent.pop()
            if not list_indent or marker_x > list_indent[-1] + 15:
                list_indent.append(marker_x)
            output.append("    " * (len(list_indent) - 1) + text)
        elif (previous and not previous.code and output and item.page
              and not (text.endswith(":") and len(text) < 60)
              and item.x0 >= previous.x0 - 8
              and (item.page != previous.page or item.top - previous.bottom < item.size * 0.85)):
            output[-1] = join_wrapped(output[-1], text)
        else:
            if output and output[-1] and previous and not previous.code:
                output.append("")
            list_indent = []
            output.append(text)
        previous = item

    if in_code:
        output.append("```")
    return "\n".join(output).strip()


def join_wrapped(left: str, right: str) -> str:
    separator = " " if re.search(r"[a-zA-Z0-9_]$", left) and re.match(r"[a-zA-Z0-9_]", right) else ""
    return left.rstrip() + separator + right.lstrip()


def escape_prose(text: str) -> str:
    # The renderer intentionally skips HTML. Unescaped C++ template arguments
    # such as <int> would otherwise disappear even from a faithful extraction.
    parts = re.split(r"(`+[^`]*`+)", text)
    result = []
    for part in parts:
        if not part.startswith("`"):
            part = re.sub(r"(?<!\\)([<>])", r"\\\1", part)
            # Bare lambda captures and reserved C++ identifiers are code,
            # not an empty link or strong-emphasis delimiters.
            part = re.sub(r"(?<!\\)\[\]\(", r"\\[\\](", part)
            part = re.sub(r"(?<![\w\\])__[A-Za-z][A-Za-z0-9_]*__(?!\w)",
                          lambda m: m[0].replace("_", r"\_"), part)
        result.append(part)
    return "".join(result)


def apply_reviewed_wrap_repairs(questions: list[dict], repairs: list[dict]) -> list[dict]:
    """Apply only reviewed whitespace repairs with exact, fail-closed guards."""
    by_id = {q["id"]: q for q in questions}
    applied = []
    for repair in repairs:
        qid, field = repair["id"], repair["field"]
        question = by_id[qid]
        before, after = repair["before"], repair["after"]
        if re.sub(r"\s+", "", before) != re.sub(r"\s+", "", after):
            raise ValueError(f"跨行修复不得改变非空白字符: {qid}.{field}")
        if (not before or question["original"][field].count(before) != 1
                or not question["sourcePages"][0] <= repair["page"] <= question["sourcePages"][1]):
            raise ValueError(f"跨行修复前置条件不符: {qid}.{field}")
        question["original"][field] = question["original"][field].replace(before, after, 1)
        applied.append(dict(repair))
    return applied


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
        working.append(replace(lines[id_index], text=prompt_first))
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
            if marker and not item.code and (not marker.group(1) or not item.size or item.size >= 12):
                if name in found:
                    issues.append(f"{question_id}: 重复字段标记 {name}")
                    break  # Keep nested/contaminated source headings in place.
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
    if buckets["prompt"] and any(line.page for line in buckets["prompt"]):
        fields["prompt"] = ""
        for line in buckets["prompt"]:
            fields["prompt"] = join_wrapped(fields["prompt"], line.text)
        fields["prompt"] = escape_prose(fields["prompt"])
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
        next_start = starts[order] if order < len(starts) else None
        end_page = next_start[1] if next_start else last_page
        combined: list[TextLine] = []
        start_line = line_index
        for page_number in range(start_page, end_page + 1):
            page = pages[page_number]
            stop = next_start[2] if next_start and page_number == next_start[1] else len(page)
            part = page[start_line if page_number == start_page else 0 : stop]
            # Chapter/section headings preceding the next question belong to
            # the hierarchy, never to the preceding answer or extension.
            part = [line for line in part if not (line.size >= 14 and
                    (CHAPTER_RE.match(line.text) or SECTION_RE.match(line.text)))]
            combined.extend(part)
        end_page = max((line.page for line in combined if line.page), default=end_page)
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
    args = parser.parse_args()

    reader = PdfReader(args.pdf)
    chapters = extract_hierarchy(reader)
    outline_section_ids = {section["id"] for chapter in chapters for section in chapter["sections"]}
    graphics_audit: list[dict] = []
    pages = visual_page_lines(args.pdf, args.body_start_page, graphics_audit=graphics_audit)
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

    from extraction_quality import assert_release_quality, verify_fidelity, raw_digest

    config = json.loads((args.content_root / "content.config.json").read_text(encoding="utf-8"))
    source_issues = config.get("extraction", {}).get("sourceIssues", {})
    report["extractorVersion"] = 3
    report["sourceSha256"] = hashlib.sha256(args.pdf.read_bytes()).hexdigest()
    repairs = config.get("extraction", {}).get("reviewedWrapRepairs", [])
    if repairs and config["extraction"].get("reviewedSourceSha256") != report["sourceSha256"]:
        raise ValueError("PDF 摘要已变化，需重新核对跨行修复")
    report["reviewedWrapRepairs"] = apply_reviewed_wrap_repairs(questions, repairs)
    report["graphicalLists"] = graphics_audit
    report["sourceIssues"] = source_issues
    report["fidelity"] = verify_fidelity(reader, pages, questions, expected_ids)
    report["status"] = "failed"
    report_path = args.content_root / "reports" / "extraction-audit.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    assert_release_quality(report, expected_ids, questions, source_issues)
    write_outputs(args.content_root, chapters, questions, report)
    report["rawSha256"] = raw_digest(args.content_root)
    report["status"] = "passed"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("pageCount", "chapterCount", "sectionCount", "questionCount")}, ensure_ascii=False))
    print(f"field issues: {len(issues)}")


if __name__ == "__main__":
    main()
