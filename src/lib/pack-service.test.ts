import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";
import { installPack, parsePackText } from "./pack-service";
import type { QuestionPack } from "./types";

const makePack = (): QuestionPack => ({
  schemaVersion: 1,
  pack: {
    id: "test.pack",
    title: "测试题库",
    version: "1.0.0",
    locale: "zh-CN",
    questionCount: 1,
    license: { scope: "private-personal-use", redistribution: false },
    source: { title: "测试来源", documentVersion: "1" }
  },
  chapters: [{ id: "1", title: "测试章", order: 1, sections: [{ id: "1.1", title: "测试节", order: 1 }] }],
  questions: [{
    id: "1.1.1",
    chapterId: "1",
    sectionId: "1.1",
    order: 1,
    sourcePages: [1, 2],
    original: { prompt: "问题", interpretation: "解读", knowledge: "知识", answer: "答案", extension: "拓展" },
    review: { status: "raw" }
  }]
});

describe("question pack", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it("validates and installs a pack", async () => {
    const parsed = parsePackText(JSON.stringify(makePack()));
    await installPack(parsed);
    expect(await db.packs.get("test.pack")).toBeTruthy();
    expect(await db.questions.where("packId").equals("test.pack").count()).toBe(1);
  });

  it("rejects duplicate question ids", () => {
    const pack = makePack();
    pack.pack.questionCount = 2;
    pack.questions.push({ ...pack.questions[0] });
    expect(() => parsePackText(JSON.stringify(pack))).toThrow("重复题号");
  });

  it("accepts authored questions and mixed packs without inventing PDF pages", async () => {
    const pack = makePack();
    const authored = { ...structuredClone(pack.questions[0]), id: "1.1.2", order: 2 };
    delete authored.sourcePages;
    pack.questions.push(authored);
    pack.pack.questionCount = 2;
    const parsed = parsePackText(JSON.stringify(pack));
    await installPack(parsed);
    expect((await db.questions.get([pack.pack.id, "1.1.2"]))?.sourcePages).toBeUndefined();
    expect(parsed.questions[0].sourcePages).toEqual([1, 2]);
    await db.userStates.put({ packId: pack.pack.id, questionId: "1.1.2", favorite: true, status: "review", updatedAt: "2026-09-09T00:00:00Z" });
    parsed.pack.version = "1.0.1";
    await installPack(parsed);
    expect(await db.userStates.get([pack.pack.id, "1.1.2"])).toMatchObject({ favorite: true, status: "review" });
  });

  it.each([null, [], [1], [1, 2, 3], [0, 1], [-1, 2], [1.5, 2], ["1", 2], [2, 1], {}].map(pages => ({ pages })))(
    "rejects explicitly invalid source pages: $pages", ({ pages }) => {
      const pack = makePack();
      const candidate = { ...pack, questions: [{ ...pack.questions[0], sourcePages: pages }] };
      expect(() => parsePackText(JSON.stringify(candidate))).toThrow();
    }
  );

  it("preserves user state during a pack upgrade", async () => {
    const pack = makePack();
    await installPack(pack);
    await db.userStates.put({ packId: "test.pack", questionId: "1.1.1", favorite: true, status: "mastered", updatedAt: "2026-01-01T00:00:00Z" });
    pack.pack.version = "1.1.0";
    await installPack(pack);
    expect((await db.userStates.get(["test.pack", "1.1.1"]))?.favorite).toBe(true);
  });

  it("rolls back an upgrade transaction when writing questions fails", async () => {
    const pack = makePack();
    await installPack(pack);
    const bulkPut = vi.spyOn(db.questions, "bulkPut");
    bulkPut.mockRejectedValueOnce(new Error("模拟写入失败"));

    pack.pack.version = "1.1.0";
    pack.questions[0].original.prompt = "不应写入";
    await expect(installPack(pack)).rejects.toThrow("模拟写入失败");

    expect((await db.packs.get("test.pack"))?.info.version).toBe("1.0.0");
    expect((await db.questions.get(["test.pack", "1.1.1"]))?.original.prompt).toBe("问题");
  });

  it("keeps only states whose stable question ids survive an upgrade", async () => {
    const pack = makePack();
    await installPack(pack);
    await db.userStates.put({ packId: "test.pack", questionId: "1.1.1", favorite: true, status: "review", updatedAt: "2026-01-01T00:00:00Z" });
    pack.pack.version = "2.0.0";
    pack.questions[0] = { ...pack.questions[0], id: "1.1.2", order: 2 };
    await installPack(pack);
    expect(await db.userStates.get(["test.pack", "1.1.1"])).toBeUndefined();
  });

  it("isolates questions and progress belonging to different packs", async () => {
    const first = makePack();
    const second = structuredClone(first);
    second.pack.id = "second.pack";
    second.pack.title = "第二题库";
    await installPack(first);
    await installPack(second);
    await db.userStates.put({ packId: "test.pack", questionId: "1.1.1", favorite: true, status: "mastered", updatedAt: "2026-01-01T00:00:00Z" });

    expect(await db.questions.where("packId").equals("test.pack").count()).toBe(1);
    expect(await db.questions.where("packId").equals("second.pack").count()).toBe(1);
    expect(await db.userStates.where("packId").equals("second.pack").count()).toBe(0);
  });

  it("rejects duplicate hierarchy ids and invalid directory references", () => {
    const duplicate = makePack();
    duplicate.chapters.push(structuredClone(duplicate.chapters[0]));
    expect(() => parsePackText(JSON.stringify(duplicate))).toThrow("重复章节 ID");

    const mismatched = makePack();
    mismatched.questions[0].sectionId = "1.2";
    expect(() => parsePackText(JSON.stringify(mismatched))).toThrow("不存在的小节");

    const wrongChapter = makePack();
    wrongChapter.chapters.push({ id: "2", title: "另一章", order: 2, sections: [{ id: "2.1", title: "另一节", order: 1 }] });
    wrongChapter.questions[0].sectionId = "2.1";
    expect(() => parsePackText(JSON.stringify(wrongChapter))).toThrow("章节与小节不匹配");

    const missingChapter = makePack();
    missingChapter.questions[0].chapterId = "2";
    expect(() => parsePackText(JSON.stringify(missingChapter))).toThrow("不存在的章节");
  });

  it("uses declared directory membership independently of stable question ids", () => {
    const pack = makePack();
    pack.chapters[0].sections.push({ id: "1.2", title: "进阶题", order: 2 });
    pack.questions[0].sectionId = "1.2";
    expect(parsePackText(JSON.stringify(pack)).questions[0]).toMatchObject({ id: "1.1.1", sectionId: "1.2" });
  });

  it("keeps viewing history, favorites and status when an upgrade moves a question", async () => {
    const pack = makePack();
    await installPack(parsePackText(JSON.stringify(pack)));
    const state = { packId: pack.pack.id, questionId: "1.1.1", favorite: true, status: "review" as const, lastViewedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
    await db.userStates.put(state);
    pack.pack.version = "1.1.0";
    pack.chapters = [{ id: "2", title: "新目录", order: 1, sections: [{ id: "2.3", title: "进阶题", order: 1 }] }];
    pack.questions[0].chapterId = "2";
    pack.questions[0].sectionId = "2.3";
    await installPack(parsePackText(JSON.stringify(pack)));
    expect(await db.userStates.get([pack.pack.id, "1.1.1"])).toEqual(state);
    expect(await db.questions.get([pack.pack.id, "1.1.1"])).toMatchObject({ id: "1.1.1", chapterId: "2", sectionId: "2.3" });
  });
});
