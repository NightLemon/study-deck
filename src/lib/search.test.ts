import { describe, expect, it } from "vitest";
import { createQuestionSearch } from "./search";
import type { StoredQuestion } from "./types";

const question: StoredQuestion = {
  packId: "search.pack",
  id: "1.1.1",
  chapterId: "1",
  sectionId: "1.1",
  order: 1,
  sourcePages: [1, 1],
  original: {
    prompt: "为什么只重复阅读通常不如主动回忆有效？",
    interpretation: "考察熟悉感与真正掌握之间的区别。",
    knowledge: "主动回忆和检索练习。",
    answer: "主动回忆会暴露知识缺口。",
    extension: "用自己的话复述并订正。"
  },
  review: { status: "raw" }
};

describe("question search", () => {
  it("finds Chinese substrings in prompts and body text", () => {
    const search = createQuestionSearch([question]);
    expect(search.search("主动回忆").map((result) => result.id)).toContain("1.1.1");
    expect(search.search("复述").map((result) => result.id)).toContain("1.1.1");
  });
});
