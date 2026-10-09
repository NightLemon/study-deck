import { db } from "./db";
import type { RecallAttempt, ReviewSchedule, StudyCollection } from "./types";

export const REVIEW_INTERVALS = [1, 3, 7, 14] as const;
export const questionKey = (packId: string, questionId: string) => JSON.stringify([packId, questionId]);
export const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export const isCalendarDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const isTimestamp = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && isCalendarDate(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60;
};

// Question references retain the existing pack contract, which has no ID length cap.
export const validQuestionId = (value: unknown): value is string =>
  typeof value === "string" && value.trim() === value && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
export const validId = (value: unknown): value is string => validQuestionId(value) && value.length <= 200;

export const addCalendarDays = (day: string, days: number) => {
  if (!isCalendarDate(day) || !Number.isInteger(days)) throw new Error("复习日期无效");
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const result = date.toISOString().slice(0, 10);
  if (!isCalendarDate(result)) throw new Error("复习日期超出支持范围");
  return result;
};

export const schedulesFromAttempts = (attempts: RecallAttempt[]): ReviewSchedule[] => {
  const schedules = new Map<string, ReviewSchedule>();
  const ordered = [...attempts].sort((a, b) => Date.parse(a.attemptedAt) - Date.parse(b.attemptedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const attempt of ordered) {
    const key = questionKey(attempt.packId, attempt.questionId);
    const previous = schedules.get(key);
    const independentStreak = attempt.selfAssessment === "correct" && !attempt.usedHint
      ? Math.min(4, (previous?.independentStreak ?? 0) + 1) : 0;
    const intervalDays = REVIEW_INTERVALS[Math.max(0, independentStreak - 1)];
    schedules.set(key, { packId: attempt.packId, questionId: attempt.questionId, independentStreak, intervalDays,
      dueOn: addCalendarDays(attempt.attemptedOn, intervalDays), lastAttemptId: attempt.id, updatedAt: attempt.attemptedAt });
  }
  return [...schedules.values()];
};

const assertQuestionInstalled = async (packId: string, questionId: string) => {
  if (!validId(packId) || !validQuestionId(questionId) || !await db.questions.get([packId, questionId])) {
    throw new Error("这道题尚未安装，请先导入对应题库");
  }
};

export const createCollection = async (name: string): Promise<StudyCollection> => {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) throw new Error("集合名称需为 1–80 个字符");
  return db.transaction("rw", db.studyCollections, async () => {
    const existing = await db.studyCollections.toArray();
    if (existing.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) throw new Error("已有同名集合，请换一个名称");
    const now = new Date().toISOString();
    const collection = { id: crypto.randomUUID(), name: trimmed, createdAt: now, updatedAt: now };
    await db.studyCollections.add(collection);
    return collection;
  });
};

export const removeCollection = async (collectionId: string) => {
  await db.transaction("rw", db.studyCollections, db.collectionMembers, async () => {
    await db.studyCollections.delete(collectionId);
    await db.collectionMembers.where("collectionId").equals(collectionId).delete();
  });
};

export const addToCollection = async (collectionId: string, packId: string, questionId: string) => {
  await db.transaction("rw", db.studyCollections, db.collectionMembers, db.questions, async () => {
    await assertQuestionInstalled(packId, questionId);
    const collection = await db.studyCollections.get(collectionId);
    if (!collection) throw new Error("学习集合不存在");
    const key: [string, string, string] = [collectionId, packId, questionId];
    if (!await db.collectionMembers.get(key)) {
      const now = new Date().toISOString();
      await db.collectionMembers.add({ collectionId, packId, questionId, addedAt: now });
      await db.studyCollections.update(collectionId, { updatedAt: monotonicCollectionTime(collection, now) });
    }
  });
};

export const removeFromCollection = async (collectionId: string, packId: string, questionId: string) => {
  await db.transaction("rw", db.studyCollections, db.collectionMembers, async () => {
    const collection = await db.studyCollections.get(collectionId);
    await db.collectionMembers.delete([collectionId, packId, questionId]);
    if (collection) await db.studyCollections.update(collectionId, { updatedAt: monotonicCollectionTime(collection, new Date().toISOString()) });
  });
};

// Imported clocks may be ahead of this device. Keep ordering metadata nondecreasing;
// this is not a new assertion about when the original remote event happened.
const monotonicCollectionTime = (collection: StudyCollection, now: string) =>
  new Date(Math.max(Date.parse(now), Date.parse(collection.createdAt), Date.parse(collection.updatedAt))).toISOString();

export type AttemptInput = Pick<RecallAttempt, "packId" | "questionId" | "answer" | "usedHint" | "selfAssessment" | "mistakeReason" | "evidence">;

export const validateAttemptFields = (input: AttemptInput) => {
  if (!validId(input.packId) || !validQuestionId(input.questionId) || typeof input.answer !== "string" || !input.answer.trim() || input.answer.length > 30000 ||
    typeof input.usedHint !== "boolean" || !["correct", "incorrect"].includes(input.selfAssessment) ||
    typeof input.mistakeReason !== "string" || input.mistakeReason.length > 4000 ||
    typeof input.evidence !== "string" || input.evidence.length > 10000 ||
    (input.selfAssessment === "incorrect" && !input.mistakeReason.trim())) throw new Error("尝试记录无效：请填写回答，并为答错的尝试说明错因");
};

export const recordAttempt = async (input: AttemptInput, now = new Date()): Promise<ReviewSchedule> => {
  validateAttemptFields(input);
  if (!Number.isFinite(now.getTime())) throw new Error("尝试时间无效");
  return db.transaction("rw", db.questions, db.recallAttempts, db.reviewSchedules, async () => {
    await assertQuestionInstalled(input.packId, input.questionId);
    const attempts = await db.recallAttempts.where("[packId+questionId]").equals([input.packId, input.questionId]).toArray();
    const lastTime = attempts.reduce((latest, attempt) => Math.max(latest, Date.parse(attempt.attemptedAt)), 0);
    if (now.getTime() < lastTime) throw new Error("设备时间早于上次尝试，请校准时间后重试");
    // Preserve deterministic ordering if two saves occur within the same millisecond.
    const effective = new Date(Math.max(now.getTime(), lastTime + 1));
    const attempt: RecallAttempt = { ...input, id: crypto.randomUUID(), attemptedAt: effective.toISOString(), attemptedOn: localDate(effective) };
    const schedule = schedulesFromAttempts([...attempts, attempt])[0];
    await db.recallAttempts.add(attempt);
    await db.reviewSchedules.put(schedule);
    return schedule;
  });
};
