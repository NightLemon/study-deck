#!/usr/bin/env python3
"""Merge immutable chapter extracts with review overlays into one question pack."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from extraction_quality import FIELDS, raw_digest


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def merge_question(question: dict, overlay: dict) -> dict:
    merged = dict(question)
    if "revision" in overlay:
        merged["revision"] = overlay["revision"]
    if "review" in overlay:
        merged["review"] = overlay["review"]
    return merged


def validate_pack(pack: dict, expected_questions: int) -> dict:
    ids = [question["id"] for question in pack["questions"]]
    section_ids = {section["id"] for chapter in pack["chapters"] for section in chapter["sections"]}
    if len(ids) != expected_questions or len(set(ids)) != expected_questions:
        raise ValueError(f"题目数量或唯一性错误: {len(ids)} / {len(set(ids))}")
    unknown = [question["id"] for question in pack["questions"] if question["sectionId"] not in section_ids]
    if unknown:
        raise ValueError(f"存在无效小节引用: {unknown[:5]}")
    for previous, current in zip(pack["questions"], pack["questions"][1:]):
        if previous["sourcePages"][0] > current["sourcePages"][0]:
            raise ValueError("来源页码不是单调递增")
    statuses = {key: 0 for key in ("raw", "reviewed", "verified")}
    for question in pack["questions"]:
        statuses[question["review"]["status"]] += 1
        fields = {**question["original"], **question.get("revision", {}).get("fields", {})}
        if any(not fields.get(name, "").strip() for name in FIELDS):
            raise ValueError(f"题目 {question['id']} 的最终学习内容存在空字段")
    return statuses


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--content-root", required=True, type=Path)
    parser.add_argument("--version", default="0.1.2")
    parser.add_argument("--expected-questions", type=int, default=963)
    args = parser.parse_args()

    config = load_json(args.content_root / "content.config.json")
    extraction_audit = load_json(args.content_root / "reports" / "extraction-audit.json")
    if extraction_audit.get("status") != "passed" or extraction_audit.get("rawSha256") != raw_digest(args.content_root):
        raise ValueError("抽取质量审计缺失、失败或与当前 raw 不一致; 请先重新运行抽取")
    chapters: list[dict] = []
    questions: list[dict] = []
    for raw_path in sorted((args.content_root / "raw").glob("chapter-*.json")):
        raw = load_json(raw_path)
        chapters.append(raw["chapter"])
        revision_path = args.content_root / "revisions" / raw_path.name
        overlays = load_json(revision_path).get("questions", {}) if revision_path.exists() else {}
        raw_ids = {q["id"] for q in raw["questions"]}
        if set(overlays) - raw_ids:
            raise ValueError(f"修订层含不存在的题号: {sorted(set(overlays) - raw_ids)}")
        questions.extend(merge_question(question, overlays.get(question["id"], {})) for question in raw["questions"])

    pack = {
        "schemaVersion": 1,
        "pack": {
            **config["pack"],
            "version": args.version,
            "questionCount": len(questions),
            "createdAt": datetime.now(timezone.utc).isoformat(),
        },
        "chapters": chapters,
        "questions": questions,
    }
    statuses = validate_pack(pack, args.expected_questions)
    for qid, issue in config.get("extraction", {}).get("sourceIssues", {}).items():
        question = next(q for q in questions if q["id"] == qid)
        revision_fields = question.get("revision", {}).get("fields", {})
        if any(not revision_fields.get(field, "").strip() for field in issue.get("requiredRevisionFields", [])):
            raise ValueError(f"源文档异常题 {qid} 尚未完成必要校订")
        if question["review"]["status"] == "raw" or not question["review"].get("notes"):
            raise ValueError(f"源文档异常题 {qid} 缺少校订状态或说明")
    output_dir = args.content_root / "dist"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"qd-cpp-1000-{args.version}.json"
    output_path.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    report = {"output": str(output_path), "questionCount": len(questions), "reviewStatuses": statuses,
              "sourceSha256": extraction_audit["sourceSha256"], "rawSha256": extraction_audit["rawSha256"],
              "extractionStatus": extraction_audit["status"]}
    (args.content_root / "reports" / "build-audit.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
