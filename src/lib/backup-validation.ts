import { isCalendarDate, isTimestamp, questionKey, schedulesFromAttempts, validateAttemptFields, validId, validQuestionId } from "./learning-service";
import type { CollectionMember, LegacyProgressBackup, ProgressBackup, RecallAttempt, ReviewSchedule, StudyCollection, UserState } from "./types";

const invalid = (): never => { throw new Error("进度备份包含无效记录或重复标识"); };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
};
const shape = (value: unknown, required: string[], optional: string[] = []) => {
  const row = object(value);
  if (required.some((key) => !Object.hasOwn(row, key)) || Object.keys(row).some((key) => !required.includes(key) && !optional.includes(key))) invalid();
  return row;
};
const rows = <T>(value: unknown, validate: (row: unknown) => T, key: (row: T) => string): T[] => {
  if (!Array.isArray(value) || value.length > 100000) return invalid();
  const result = value.map(validate);
  if (new Set(result.map(key)).size !== result.length) invalid();
  return result;
};
const timestamp = (value: unknown) => {
  if (!isTimestamp(value)) return invalid();
  return new Date(value).toISOString();
};
const id = (value: unknown) => { if (!validId(value)) return invalid(); return value; };
const questionId = (value: unknown) => { if (!validQuestionId(value)) return invalid(); return value; };

const state = (value: unknown): UserState => {
  const row = shape(value, ["packId", "questionId", "favorite", "status", "updatedAt"], ["lastViewedAt"]);
  if (typeof row.favorite !== "boolean" || typeof row.status !== "string" || !["new", "review", "mastered"].includes(row.status)) return invalid();
  return { packId: id(row.packId), questionId: questionId(row.questionId), favorite: row.favorite, status: row.status as UserState["status"], updatedAt: timestamp(row.updatedAt),
    ...(row.lastViewedAt !== undefined ? { lastViewedAt: timestamp(row.lastViewedAt) } : {}) };
};

const collection = (value: unknown): StudyCollection => {
  const row = shape(value, ["id", "name", "createdAt", "updatedAt"]);
  if (typeof row.name !== "string" || row.name.trim() !== row.name || !row.name || row.name.length > 80) return invalid();
  const createdAt = timestamp(row.createdAt), updatedAt = timestamp(row.updatedAt);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) return invalid();
  return { id: id(row.id), name: row.name, createdAt, updatedAt };
};

const member = (value: unknown): CollectionMember => {
  const row = shape(value, ["collectionId", "packId", "questionId", "addedAt"]);
  return { collectionId: id(row.collectionId), packId: id(row.packId), questionId: questionId(row.questionId), addedAt: timestamp(row.addedAt) };
};

const attempt = (value: unknown): RecallAttempt => {
  const row = shape(value, ["id", "packId", "questionId", "answer", "usedHint", "selfAssessment", "mistakeReason", "evidence", "attemptedAt", "attemptedOn"]);
  validateAttemptFields(row as unknown as RecallAttempt);
  const attemptedAt = timestamp(row.attemptedAt);
  if (!isCalendarDate(row.attemptedOn) || Math.abs(Date.parse(`${row.attemptedOn}T12:00:00Z`) - Date.parse(attemptedAt)) > 36 * 60 * 60 * 1000) return invalid();
  return { id: id(row.id), packId: id(row.packId), questionId: questionId(row.questionId), answer: row.answer as string, usedHint: row.usedHint as boolean,
    selfAssessment: row.selfAssessment as RecallAttempt["selfAssessment"], mistakeReason: row.mistakeReason as string, evidence: row.evidence as string,
    attemptedAt, attemptedOn: row.attemptedOn };
};

const schedule = (value: unknown): ReviewSchedule => {
  const row = shape(value, ["packId", "questionId", "independentStreak", "intervalDays", "dueOn", "lastAttemptId", "updatedAt"]);
  if (typeof row.independentStreak !== "number" || !Number.isInteger(row.independentStreak) || row.independentStreak < 0 || row.independentStreak > 4 ||
    typeof row.intervalDays !== "number" || ![1, 3, 7, 14].includes(row.intervalDays) || !isCalendarDate(row.dueOn)) return invalid();
  return { packId: id(row.packId), questionId: questionId(row.questionId), independentStreak: row.independentStreak,
    intervalDays: row.intervalDays as ReviewSchedule["intervalDays"], dueOn: row.dueOn, lastAttemptId: id(row.lastAttemptId), updatedAt: timestamp(row.updatedAt) };
};

export const validateBackup = (value: unknown): LegacyProgressBackup | ProgressBackup => {
  const root = object(value);
  if (root.schemaVersion !== 1 && root.schemaVersion !== 2) throw new Error("不支持的进度备份格式");
  const common = { exportedAt: root.exportedAt === undefined && root.schemaVersion === 1 ? new Date(0).toISOString() : timestamp(root.exportedAt),
    states: rows(root.states, state, (item) => questionKey(item.packId, item.questionId)) };
  if (root.schemaVersion === 1) {
    shape(root, ["schemaVersion", "states"], ["exportedAt"]);
    return { schemaVersion: 1, ...common };
  }
  shape(root, ["schemaVersion", "exportedAt", "states", "collections", "members", "attempts", "schedules"]);
  const result: ProgressBackup = { schemaVersion: 2, ...common,
    collections: rows(root.collections, collection, (item) => item.id),
    members: rows(root.members, member, (item) => JSON.stringify([item.collectionId, item.packId, item.questionId])),
    attempts: rows(root.attempts, attempt, (item) => item.id),
    schedules: rows(root.schedules, schedule, (item) => questionKey(item.packId, item.questionId)) };
  if (new Set(result.collections.map((item) => item.name.toLowerCase())).size !== result.collections.length) invalid();
  const collectionIds = new Set(result.collections.map((item) => item.id));
  if (result.members.some((item) => !collectionIds.has(item.collectionId))) invalid();
  const computed = schedulesFromAttempts(result.attempts);
  if (computed.length !== result.schedules.length) invalid();
  const supplied = new Map(result.schedules.map((item) => [questionKey(item.packId, item.questionId), item]));
  for (const expected of computed) {
    const actual = supplied.get(questionKey(expected.packId, expected.questionId));
    if (!actual || (Object.keys(expected) as (keyof ReviewSchedule)[]).some((key) => actual[key] !== expected[key])) invalid();
  }
  return result;
};
