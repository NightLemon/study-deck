import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import questionPackSchema from "../../schema/question-pack.schema.json";
import { db } from "./db";
import type { QuestionPack, StoredQuestion } from "./types";

export const MAX_PACK_BYTES = 25 * 1024 * 1024;

const createPackValidator = () => {
  try {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    return ajv.compile<QuestionPack>(questionPackSchema);
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
    throw new Error(`题库 Schema 初始化失败：${detail}`);
  }
};

const validatePack = createPackValidator();

const formatErrors = (errors: ErrorObject[] | null | undefined) =>
  (errors ?? [])
    .slice(0, 8)
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "格式错误"}`)
    .join("；");

const assertSemanticIntegrity = (pack: QuestionPack) => {
  if (pack.questions.length !== pack.pack.questionCount) {
    throw new Error(`题目数量不一致：声明 ${pack.pack.questionCount}，实际 ${pack.questions.length}`);
  }

  const chapterIds = new Set<string>();
  const sectionIds = new Set<string>();
  const questionIds = new Set<string>();

  for (const chapter of pack.chapters) {
    if (chapterIds.has(chapter.id)) throw new Error(`发现重复章节 ID：${chapter.id}`);
    chapterIds.add(chapter.id);
    for (const section of chapter.sections) {
      if (sectionIds.has(section.id)) throw new Error(`发现重复小节 ID：${section.id}`);
      if (!section.id.startsWith(`${chapter.id}.`)) {
        throw new Error(`小节 ${section.id} 不属于章节 ${chapter.id}`);
      }
      sectionIds.add(section.id);
    }
  }

  for (const question of pack.questions) {
    if (questionIds.has(question.id)) throw new Error(`发现重复题号：${question.id}`);
    questionIds.add(question.id);
    if (!chapterIds.has(question.chapterId)) throw new Error(`题目 ${question.id} 引用了不存在的章节`);
    if (!sectionIds.has(question.sectionId)) throw new Error(`题目 ${question.id} 引用了不存在的小节`);
    if (!question.sectionId.startsWith(`${question.chapterId}.`)) {
      throw new Error(`题目 ${question.id} 的章节与小节不匹配`);
    }
    if (!question.id.startsWith(`${question.sectionId}.`)) {
      throw new Error(`题目 ${question.id} 与声明的小节 ${question.sectionId} 不匹配`);
    }
    if (question.sourcePages[0] > question.sourcePages[1]) {
      throw new Error(`题目 ${question.id} 的来源页码倒置`);
    }
    for (const reference of question.revision?.references ?? []) {
      const url = new URL(reference.url);
      if (url.protocol !== "https:") throw new Error(`题目 ${question.id} 含非 HTTPS 参考链接`);
    }
  }
};

export const parsePackText = (text: string): QuestionPack => {
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON");
  }

  if (!validatePack(candidate)) {
    throw new Error(`题库格式校验失败：${formatErrors(validatePack.errors)}`);
  }

  assertSemanticIntegrity(candidate);
  return candidate;
};

export const parsePackFile = async (file: File): Promise<QuestionPack> => {
  if (file.size > MAX_PACK_BYTES) throw new Error("题库文件超过 25 MB 限制");
  return parsePackText(await file.text());
};

export const installPack = async (pack: QuestionPack) => {
  const now = new Date().toISOString();
  const storedQuestions: StoredQuestion[] = pack.questions.map((question) => ({
    ...question,
    packId: pack.pack.id
  }));

  const incomingQuestionIds = new Set(pack.questions.map((question) => question.id));

  await db.transaction("rw", db.packs, db.questions, db.userStates, async () => {
    const existing = await db.packs.get(pack.pack.id);
    await db.questions.where("packId").equals(pack.pack.id).delete();
    await db.questions.bulkPut(storedQuestions);
    const existingStates = await db.userStates.where("packId").equals(pack.pack.id).toArray();
    const removedQuestionKeys = existingStates
      .filter((state) => !incomingQuestionIds.has(state.questionId))
      .map((state) => [state.packId, state.questionId] as [string, string]);
    if (removedQuestionKeys.length > 0) await db.userStates.bulkDelete(removedQuestionKeys);
    await db.packs.put({
      id: pack.pack.id,
      info: pack.pack,
      chapters: pack.chapters,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now
    });
  });
};

export const removePack = async (packId: string, removeProgress = false) => {
  await db.transaction("rw", db.packs, db.questions, db.userStates, async () => {
    await db.packs.delete(packId);
    await db.questions.where("packId").equals(packId).delete();
    if (removeProgress) await db.userStates.where("packId").equals(packId).delete();
  });
};
