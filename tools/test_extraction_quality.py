import json
import subprocess
import sys
from pathlib import Path

import pytest

from extraction_quality import FIELDS, assert_release_quality, canonical_content, raw_digest


def test_canonical_comparison_retains_decimals_list_numbers_paths_and_operators():
    assert canonical_content("0.1个tick") == "0.1个tick"
    assert canonical_content("5. 40Gbps") == canonical_content("5.40Gbps")
    assert canonical_content("./program") == "./program"
    assert canonical_content("```cpp\nx <= y;\n``` ") == "x<=y;"
    assert canonical_content("3.赋值 2.构造") == "3.赋值2.构造"


def example():
    question = {"id": "1.1.1", "original": {name: "内容" for name in FIELDS}}
    report = {"emptyFields": {name: [] for name in FIELDS}, "issues": [],
              "fidelity": {"promptMismatches": [], "characterMismatches": [], "readingOrderMismatches": []}}
    return question, report


def test_same_count_different_ids_and_unregistered_empty_fields_fail():
    question, report = example()
    with pytest.raises(ValueError, match="题号不一致"):
        assert_release_quality(report, {"1.1.2"}, [question], {})
    report["emptyFields"]["answer"] = ["1.1.1"]
    with pytest.raises(ValueError, match="空字段"):
        assert_release_quality(report, {"1.1.1"}, [question], {})


def test_unclosed_fence_and_duplicate_sections_stop_release():
    question, report = example()
    question["original"]["answer"] = "```cpp\nint n;"
    with pytest.raises(ValueError, match="围栏未闭合"):
        assert_release_quality(report, {"1.1.1"}, [question], {})
    question["original"]["answer"] = "内容"
    report["issues"] = ["1.1.1: 重复字段标记 answer"]
    with pytest.raises(ValueError, match="重复字段"):
        assert_release_quality(report, {"1.1.1"}, [question], {})


def test_build_refuses_a_stale_successful_audit(tmp_path):
    (tmp_path / "raw").mkdir()
    (tmp_path / "reports").mkdir()
    raw = tmp_path / "raw" / "chapter-01.json"
    raw.write_text('{"questions": []}', encoding="utf-8")
    (tmp_path / "content.config.json").write_text('{"pack": {}}', encoding="utf-8")
    report = {"status": "passed", "rawSha256": raw_digest(tmp_path)}
    (tmp_path / "reports" / "extraction-audit.json").write_text(json.dumps(report), encoding="utf-8")
    raw.write_text('{"questions": ["changed"]}', encoding="utf-8")
    result = subprocess.run([sys.executable, "-X", "utf8", str(Path(__file__).with_name("build_pack.py")),
                             "--content-root", str(tmp_path)], capture_output=True, text=True, encoding="utf-8")
    assert result.returncode != 0
    assert "与当前 raw 不一致" in result.stderr
    assert not (tmp_path / "dist").exists()
