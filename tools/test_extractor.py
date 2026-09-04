from pack_extractor import TextLine, normalize_id, normalize_text, split_fields


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
            TextLine("答案"),
            TextLine("拓展思考:"),
            TextLine("拓展"),
        ],
    )
    assert not issues
    assert fields["prompt"] == "问题的前半句,\n问题的后半句?"
