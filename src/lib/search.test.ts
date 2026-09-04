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
    prompt: "一个结构体刚好等于 64 字节，是否意味着它一定不会产生伪共享？",
    interpretation: "考察布局。",
    knowledge: "缓存行和对象对齐。",
    answer: "对象起始地址也必须对齐。",
    extension: "使用硬件计数器验证。"
  },
  review: { status: "raw" }
};

describe("question search", () => {
  it("finds Chinese substrings in prompts and body text", () => {
    const search = createQuestionSearch([question]);
    expect(search.search("伪共享").map((result) => result.id)).toContain("1.1.1");
    expect(search.search("硬件计数器").map((result) => result.id)).toContain("1.1.1");
  });
});
