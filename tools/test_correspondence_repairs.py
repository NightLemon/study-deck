from types import SimpleNamespace

import pytest

from extraction_quality import canonical_content, compare_reference, FIELDS
from pack_extractor import (TextLine, apply_reviewed_wrap_repairs, escape_prose,
                            markdownize, normalize_text, restore_graphical_lists)


def test_math_notation_survives_compatibility_normalization():
    assert normalize_text("ＡＰＩ ⾼ ﬁ O(n²) μ₄/σ⁴ Σx³ e\u0301") == "API 高 fi O(n²) μ₄/σ⁴ Σx³ é"
    assert canonical_content("O(n²)") != canonical_content("O(n2)")
    assert canonical_content("μ₄/σ⁴") != canonical_content("μ4/σ4")
    original = {field: "O(n²)" for field in FIELDS}
    report = compare_reference([{"id": "1.1.1", "original": {**original, "answer": "O(n2)"}}],
                               {"1.1.1": original})
    assert report["characterMismatches"]


def test_bare_code_symbols_are_escaped_but_markdown_and_code_are_unchanged():
    text = "lambda []() 与 __attribute__((packed))，**重点** 和 `__attribute__ []()`"
    result = escape_prose(text)
    assert result == r"lambda \[\]() 与 \_\_attribute\_\_((packed))，**重点** 和 `__attribute__ []()`"
    assert escape_prose(result) == result
    assert canonical_content(result) == canonical_content(text)
    assert markdownize([TextLine('auto f = []() { return "__name__"; };', code=True)]) == (
        '```cpp\nauto f = []() { return "__name__"; };\n```')
    assert canonical_content('```cpp\n"\\_"\n```') != canonical_content('```cpp\n"_"\n```')


def mark(x=130, top=105, width=5, **extra):
    return {"x0": x, "x1": x + width, "top": top, "bottom": top + width,
            "width": width, "height": width, **extra}


def page(images=(), curves=()):
    return SimpleNamespace(images=list(images), curves=list(curves), rects=[], width=600, height=800)


def test_graphical_bullet_forces_a_new_item_instead_of_joining_prose():
    lines = [TextLine("前一项", x0=145, top=85, bottom=96.5, size=11.5, page=1),
             TextLine("使用 std::int32_t", x0=145, top=100, bottom=111.5, size=11.5, page=1),
             TextLine("保证位宽。", x0=145, top=114, bottom=125.5, size=11.5, page=1)]
    audit = []
    result = restore_graphical_lists(page(images=[mark()]), lines, 1, audit)
    assert result[1].bullet == "raster"
    assert markdownize(result) == "前一项\n\n- 使用 std::int32_t保证位宽。"
    assert audit[0]["status"] == "mapped"


def test_vector_outlines_are_deduplicated_and_existing_markers_are_not_doubled():
    lines = [TextLine("- 项目", x0=145, top=100, bottom=111.5, size=11.5, page=1)]
    audit = []
    result = restore_graphical_lists(page(curves=[mark(fill=True), mark(x=131, top=106, width=3, fill=True)]),
                                    lines, 1, audit)
    assert len(audit) == 1
    assert markdownize(result) == "- 项目"


def test_off_page_ambiguous_and_code_marks_never_create_lists():
    lines = [TextLine("first", x0=145, top=100, bottom=110, size=11.5, page=1),
             TextLine("second", x0=145, top=105, bottom=115, size=11.5, page=1),
             TextLine("int n;", code=True, x0=145, top=200, bottom=210, size=10, page=1)]
    audit = []
    result = restore_graphical_lists(page(images=[mark(), mark(top=202), mark(top=900)]), lines, 1, audit)
    assert [x["status"] for x in audit] == ["ambiguous", "unmapped", "off-page"]
    assert not any(line.bullet for line in result)


def test_reviewed_wrap_repairs_require_exact_source_and_only_change_whitespace():
    repair = {"id": "1.1.1", "field": "answer", "page": 2,
              "before": "Duration.of Millis(100)", "after": "Duration.ofMillis(100)"}
    question = {"id": "1.1.1", "sourcePages": [1, 2], "original": {"answer": repair["before"]}}
    assert apply_reviewed_wrap_repairs([question], [repair]) == [repair]
    assert question["original"]["answer"] == repair["after"]
    with pytest.raises(ValueError, match="前置条件"):
        apply_reviewed_wrap_repairs([question], [repair])
    with pytest.raises(ValueError, match="非空白字符"):
        apply_reviewed_wrap_repairs([question], [{**repair, "after": "Duration.ofMillis(200)"}])


def test_reviewed_command_boundary_is_a_visible_paragraph_break():
    repair = {"id": "1.1.1", "field": "answer", "page": 1,
              "before": "./program perf report", "after": "./program\n\nperf report"}
    question = {"id": "1.1.1", "sourcePages": [1, 1], "original": {"answer": "perf record " + repair["before"]}}
    apply_reviewed_wrap_repairs([question], [repair])
    assert question["original"]["answer"].splitlines() == ["perf record ./program", "", "perf report"]


def test_new_numbered_list_after_prose_does_not_swallow_nested_bullets():
    lines = [TextLine("前一段测试设计。", x0=150, top=100, bottom=111.5, size=11.5, page=1),
             TextLine("4. 持久化策略", x0=120, top=125, bottom=136.5, size=11.5, page=1),
             TextLine("测试同步刷盘。", x0=160, top=145, bottom=156.5, size=11.5,
                      page=1, bullet="vector", marker_x0=145)]
    assert markdownize(lines) == "前一段测试设计。\n\n4. 持久化策略\n    - 测试同步刷盘。"