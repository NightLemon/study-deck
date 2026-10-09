from types import SimpleNamespace

from pack_extractor import (TextLine, extract_questions, find_question_starts, layout_lines,
                            markdownize, normalize_id, normalize_text, split_fields, classify_document_blocks)


def test_normalization() -> None:
    assert normalize_text("ＡＰＩ  设计") == "API 设计"
    assert normalize_id("2. 5. 6") == "2.5.6"


def test_four_part_split_and_code_fence() -> None:
    fields, issues = split_fields(
        "1.1.1",
        [
            TextLine("1.1.1 示例问题?"),
            TextLine("题目解读:"),
            TextLine("检查拆分。"),
            TextLine("知识点:"),
            TextLine("列表。"),
            TextLine("答案:"),
            TextLine("int value = 1;", True),
            TextLine("拓展思考:"),
            TextLine("继续讨论。"),
        ],
    )
    assert not issues
    assert fields["prompt"] == "示例问题?"
    assert "```cpp" in fields["answer"]


def test_split_question_id_between_prompt_lines() -> None:
    fields, issues = split_fields(
        "13.2.1",
        [
            TextLine("问题的前半句,"),
            TextLine("13.2.1"),
            TextLine("问题的后半句?"),
            TextLine("题目解读:"),
            TextLine("解读"),
            TextLine("知识点:"),
            TextLine("知识"),
            TextLine("答案:"),
            TextLine("具体答案"),
            TextLine("拓展思考:"),
            TextLine("拓展"),
        ],
    )
    assert not issues
    assert fields["prompt"].replace("\n", "") == "问题的前半句,问题的后半句?"


def glyph(text, x, top, font="Arial", size=14.5):
    return {"text": text, "x0": x, "x1": x + len(text) * 7,
            "top": top, "bottom": top + size, "size": size, "fontname": font}


def test_mixed_fonts_across_old_rounding_boundary_keep_the_whole_heading():
    page = SimpleNamespace(chars=[glyph("15.1.4", 96, 65.13),
                                  glyph("请分析", 144, 64.13, "YaHei"),
                                  glyph("std::atomic", 188, 65.13),
                                  glyph("和普通变量", 270, 64.13, "YaHei")], images=[], rects=[], curves=[])
    lines = layout_lines(page, 1178)
    assert len(lines) == 1
    assert lines[0].text.replace(" ", "") == "15.1.4请分析std::atomic和普通变量"


def test_inline_monospace_and_ligature_are_not_separate_lines_or_code_blocks():
    page = SimpleNamespace(chars=[glyph("使用", 96, 100, "YaHei", 11.5),
                                  glyph("int", 111, 104.9, "Courier", 11.5),
                                  glyph("类型", 133, 100, "YaHei", 11.5),
                                  glyph("pro", 96, 125, size=11.5),
                                  glyph("ﬁ", 117, 124.8, "Times", 11.5),
                                  glyph("ling", 124, 125, size=11.5)], images=[], rects=[], curves=[])
    lines = layout_lines(page, 1)
    assert [line.text for line in lines] == ["使用int类型", "profiling"]
    assert not any(line.code for line in lines)


def test_code_comments_short_closers_indentation_and_string_spaces_survive():
    chars = [glyph("//", 110, 94.9, "Courier", 10.45), glyph("中文注释", 130, 90.4, "YaHei", 10.45),
             glyph('puts("a  b");', 135, 107, "Courier", 10.45), glyph("};", 110, 120, "Courier", 10.45)]
    page = SimpleNamespace(chars=chars, images=[{"x0": 96, "x1": 510, "top": 72, "bottom": 150,
                                                 "width": 414, "height": 78}], rects=[], curves=[])
    lines = layout_lines(page, 1)
    assert len(lines) == 3 and all(line.code for line in lines)
    result = markdownize(lines)
    assert result.count("```cpp") == 1
    assert '// 中文注释\n    puts("a  b");\n};\n```' in result


def test_multiple_questions_on_one_page_and_next_chapter_boundary():
    def line(text, page=1, size=11.5):
        return TextLine(text, page=page, size=size)
    pages = {1: [line("1.1.1 第一题?", size=14.5), line("题目解读:", size=12.95), line("解读"),
                 line("知识点:", size=12.95), line("知识"), line("答案:", size=12.95), line("内容"),
                 line("拓展思考:", size=12.95), line("拓展"),
                 line("1.1.2 第二题?", size=14.5), line("题目解读:", size=12.95), line("解读")],
             2: [line("知识点:", 2, 12.95), line("知识", 2), line("答案:", 2, 12.95), line("内容", 2),
                 line("拓展思考:", 2, 12.95), line("拓展", 2), line("2 新章", 2, 14.5),
                 line("2.1 新节", 2, 14.5), line("2.1.1 第三题?", 2, 14.5)]}
    starts = find_question_starts(pages)
    assert len(starts) == 3
    questions, _ = extract_questions(pages, starts)
    assert questions[0]["sourcePages"] == [1, 1]
    assert questions[1]["sourcePages"] == [1, 2]
    assert questions[1]["original"]["extension"] == "拓展"


def test_body_mentions_of_answer_do_not_change_fields():
    fields, _ = split_fields("1.1.1", [TextLine("1.1.1 问题?"),
                                      TextLine("题目解读:", size=12.95),
                                      TextLine("答案:应先说明思路", size=11.5)])
    assert fields["interpretation"] == "答案:应先说明思路"


def test_raised_bullet_does_not_detach_inline_code():
    page = SimpleNamespace(chars=[glyph("。", 90, 98, "YaHei", 11.5),
                                  glyph("使用", 105, 100, "YaHei", 11.5),
                                  glyph("std::atomic", 120, 104.9, "Courier", 11.5)], images=[], rects=[], curves=[])
    lines = layout_lines(page, 1)
    assert len(lines) == 1 and not lines[0].code
    assert markdownize(lines) == "- 使用std::atomic"


def test_decimal_continuation_and_html_like_cpp_types():
    lines = [TextLine("性能达到", page=1, size=11.5),
             TextLine("99.99%,使用std::vector<int>与`std::vector<T>`。", page=1, size=11.5)]
    assert markdownize(lines) == r"性能达到99.99%,使用std::vector\<int\>与`std::vector<T>`。"


def test_literal_markdown_container_and_short_code_comments():
    lines = [TextLine("> 题目解读:", True, size=10.45, block=0),
             TextLine("**讨论**", True, size=10.45, block=0),
             TextLine("```cpp", True, size=10.45, block=0),
             TextLine("int n;", True, size=10.45, block=0),
             TextLine("```", True, size=10.45, block=0)]
    classified = classify_document_blocks(lines)
    assert [line.code for line in classified] == [False, False, True, True, True]
    assert markdownize(classified).count("```cpp") == 1


def test_fidelity_detects_missing_words_reordering_and_decimal_changes():
    from extraction_quality import compare_reference, FIELDS
    source = {field: "完整内容" for field in FIELDS}
    question = {"id": "1.1.1", "original": {**source, "prompt": "内容"}}
    report = compare_reference([question], {"1.1.1": source})
    assert report["promptMismatches"] and report["characterMismatches"]
    question["original"]["prompt"] = "内容完整"
    assert compare_reference([question], {"1.1.1": source})["readingOrderMismatches"]
    source["prompt"] = "0.1个tick"
    question["original"]["prompt"] = "1个tick"
    assert compare_reference([question], {"1.1.1": source})["characterMismatches"]
