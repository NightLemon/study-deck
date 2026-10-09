import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import sample from "../../public/sample-pack.json";
import { db, StudyDatabase } from "./db";
import { addCalendarDays, addToCollection, createCollection, localDate, recordAttempt, removeFromCollection, schedulesFromAttempts } from "./learning-service";
import { installPack, parsePackText, removePack } from "./pack-service";
import { validateBackup } from "./backup-validation";
import { createProgressBackup, importProgressBackup, updateUserState } from "./progress-service";
import type { QuestionPack, RecallAttempt } from "./types";

const makePack = (id = "practice.pack") => {
  const pack = structuredClone(sample) as QuestionPack;
  pack.pack.id = id;
  return pack;
};
const questionId = sample.questions[0].id;
const attemptInput = (packId = "practice.pack") => ({ packId, questionId, answer: "我先写下自己的回答", usedHint: false,
  selfAssessment: "correct" as const, mistakeReason: "", evidence: "https://example.com/my-practice" });
const attempt = (n: number, patch: Partial<RecallAttempt> = {}): RecallAttempt => ({ ...attemptInput(), id: `attempt-${n}`,
  attemptedAt: `2026-09-${String(10 + n).padStart(2, "0")}T08:00:00.000Z`, attemptedOn: `2026-09-${String(10 + n).padStart(2, "0")}`, ...patch });

describe("personal practice records", () => {
  beforeEach(async () => { await db.delete(); await db.open(); });

  it("migrates a real v2 database without changing existing state or question content", async () => {
    const name = `migration-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(2).stores({ packs: "id, installedAt, updatedAt", questions: "[packId+id], packId, chapterId, sectionId, review.status", userStates: "[packId+questionId], packId, favorite, status, updatedAt" });
    await old.open();
    const state = { packId: "old.pack", questionId, favorite: true, status: "mastered", updatedAt: "2026-01-01T00:00:00Z", lastViewedAt: "2026-01-01T00:00:00Z" };
    await old.table("userStates").put(state);
    await old.table("questions").put({ ...sample.questions[0], packId: "old.pack" });
    old.close();
    const upgraded = new StudyDatabase(name);
    try {
      await upgraded.open();
      expect(upgraded.verno).toBe(3);
      expect(await upgraded.userStates.get(["old.pack", questionId])).toEqual(state);
      expect((await upgraded.questions.get(["old.pack", questionId]))?.review).toEqual(sample.questions[0].review);
      expect(await upgraded.recallAttempts.count()).toBe(0);
      expect(await upgraded.reviewSchedules.count()).toBe(0);
      expect(await upgraded.studyCollections.count()).toBe(0);
    } finally { await upgraded.delete(); }
  });

  it("uses 1/3/7/14 days only for independent correct attempts and caps at 14", () => {
    const attempts = [1, 2, 3, 4, 5].map((n) => attempt(n));
    for (const [count, expected] of [[1, 1], [2, 3], [3, 7], [4, 14], [5, 14]]) {
      expect(schedulesFromAttempts(attempts.slice(0, count))[0].intervalDays).toBe(expected);
    }
    const hinted = schedulesFromAttempts([...attempts, attempt(6, { usedHint: true })])[0];
    expect(hinted).toMatchObject({ intervalDays: 1, independentStreak: 0, dueOn: "2026-09-17" });
    const error = schedulesFromAttempts([...attempts, attempt(6, { selfAssessment: "incorrect", mistakeReason: "遗漏边界" })])[0];
    expect(error).toMatchObject({ intervalDays: 1, independentStreak: 0 });
    expect(schedulesFromAttempts([...attempts, attempt(6, { usedHint: true }), attempt(7)])[0].intervalDays).toBe(1);
  });

  it("roundtrips legal long question IDs through old state and all personal practice tables", async () => {
    const pack = makePack();
    const longId = `${pack.questions[0].sectionId}.${"7".repeat(201)}`;
    pack.questions[0].id = longId;
    await installPack(parsePackText(JSON.stringify(pack)));
    await updateUserState(pack.pack.id, longId, { favorite: true, status: "mastered" });
    const collection = await createCollection("合法长题号");
    await addToCollection(collection.id, pack.pack.id, longId);
    await recordAttempt({ ...attemptInput(), questionId: longId });
    const original = await createProgressBackup();
    expect(() => validateBackup(original)).not.toThrow();
    await importProgressBackup(JSON.stringify({ schemaVersion: 1, states: original.states }), "replace");
    expect((await db.userStates.get([pack.pack.id, longId]))?.favorite).toBe(true);
    await db.delete(); await db.open();
    await importProgressBackup(JSON.stringify(original), "replace");
    await installPack(pack);
    const restored = await createProgressBackup();
    expect({ ...restored, exportedAt: "ignored" }).toEqual({ ...original, exportedAt: "ignored" });
    await removeFromCollection(collection.id, pack.pack.id, longId);
    expect(await db.collectionMembers.count()).toBe(0);
  });

  it("keeps a future collection timestamp valid through add, removal and backup restore", async () => {
    await installPack(makePack());
    const original = await createProgressBackup();
    const createdAt = new Date(Date.now() + 60_000).toISOString();
    const updatedAt = new Date(Date.now() + 120_000).toISOString();
    original.collections = [{ id: "ahead-device", name: "跨设备", createdAt, updatedAt }];
    await importProgressBackup(JSON.stringify(original), "replace");
    await addToCollection("ahead-device", "practice.pack", questionId);
    const added = await createProgressBackup();
    expect(added.collections[0].updatedAt).toBe(updatedAt);
    expect(() => validateBackup(added)).not.toThrow();
    await removeFromCollection("ahead-device", "practice.pack", questionId);
    const removed = await createProgressBackup();
    expect(removed.collections[0].updatedAt).toBe(updatedAt);
    expect(removed.members).toHaveLength(0);
    await db.delete(); await db.open();
    await importProgressBackup(JSON.stringify(removed), "replace");
    expect((await db.studyCollections.get("ahead-device"))?.createdAt).toBe(createdAt);
    expect((await db.studyCollections.get("ahead-device"))?.updatedAt).toBe(updatedAt);
  });

  it("uses calendar dates across leap years, month/year boundaries and local time", () => {
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2026-03-07", 3)).toBe("2026-03-10");
    expect(localDate(new Date(2026, 8, 15, 23, 59))).toBe("2026-09-15");
    expect(() => addCalendarDays("2026-02-30", 1)).toThrow();
  });

  it("keeps collection references and attempts isolated for the same question ID in two packs", async () => {
    await installPack(makePack()); await installPack(makePack("other.pack"));
    const collection = await createCollection("重点练习");
    await addToCollection(collection.id, "practice.pack", questionId);
    await addToCollection(collection.id, "practice.pack", questionId);
    await addToCollection(collection.id, "other.pack", questionId);
    expect(await db.collectionMembers.count()).toBe(2);
    expect(Object.keys((await db.collectionMembers.toArray())[0]).sort()).toEqual(["addedAt", "collectionId", "packId", "questionId"]);
    await updateUserState("practice.pack", questionId, { favorite: true, status: "mastered" });
    await recordAttempt(attemptInput(), new Date("2026-09-15T10:00:00Z"));
    expect(await db.reviewSchedules.get(["other.pack", questionId])).toBeUndefined();
    expect(await db.userStates.get(["practice.pack", questionId])).toMatchObject({ favorite: true, status: "mastered" });
    expect((await db.questions.get(["practice.pack", questionId]))?.review).toEqual(sample.questions[0].review);
  });

  it("rejects attempts or new collection membership for missing questions", async () => {
    const collection = await createCollection("空集合");
    await expect(addToCollection(collection.id, "missing", questionId)).rejects.toThrow("尚未安装");
    await expect(recordAttempt(attemptInput())).rejects.toThrow("尚未安装");
    expect(await db.recallAttempts.count()).toBe(0);
  });

  it("validates response, hint, self assessment and mistake reason", async () => {
    await installPack(makePack());
    for (const patch of [{ answer: " " }, { usedHint: "no" }, { selfAssessment: "verified" }, { selfAssessment: "incorrect", mistakeReason: "" }]) {
      await expect(recordAttempt({ ...attemptInput(), ...patch } as Parameters<typeof recordAttempt>[0])).rejects.toThrow("无效");
    }
    expect(await db.recallAttempts.count()).toBe(0);
  });

  it("diagnoses backwards device time rather than inventing a later practice date", async () => {
    await installPack(makePack());
    await recordAttempt(attemptInput(), new Date("2026-09-15T10:00:00Z"));
    await expect(recordAttempt(attemptInput(), new Date("2026-09-14T10:00:00Z"))).rejects.toThrow("设备时间");
    expect(await db.recallAttempts.count()).toBe(1);
  });

  it("roundtrips v2 backup while packs are uninstalled and restores references on later install", async () => {
    await installPack(makePack());
    const collection = await createCollection("恢复练习");
    await addToCollection(collection.id, "practice.pack", questionId);
    await updateUserState("practice.pack", questionId, { favorite: true, status: "review" });
    await recordAttempt(attemptInput(), new Date("2026-09-15T10:00:00Z"));
    const backup = await createProgressBackup();
    expect(backup.schemaVersion).toBe(2);
    await db.delete(); await db.open();
    await importProgressBackup(JSON.stringify(backup), "replace");
    expect(await db.packs.count()).toBe(0);
    const restored = await createProgressBackup();
    expect({ ...restored, exportedAt: "ignored" }).toEqual({ ...backup, exportedAt: "ignored" });
    await installPack(makePack("other.pack"));
    expect(await db.reviewSchedules.get(["other.pack", questionId])).toBeUndefined();
    await installPack(makePack());
    expect(await db.collectionMembers.count()).toBe(1);
    expect(await db.recallAttempts.count()).toBe(1);
    expect((await db.userStates.get(["practice.pack", questionId]))?.favorite).toBe(true);
  });

  it("imports old backups, including orphan state, without erasing new records in legacy replace", async () => {
    await installPack(makePack());
    await recordAttempt(attemptInput(), new Date("2026-09-15T10:00:00Z"));
    const old = { schemaVersion: 1, exportedAt: "2026-09-15T00:00:00Z", states: [{ packId: "uninstalled.pack", questionId, favorite: true, status: "mastered", updatedAt: "2026-09-15T00:00:00Z" }] };
    await importProgressBackup(JSON.stringify(old), "replace");
    expect(await db.recallAttempts.count()).toBe(1);
    expect(await db.reviewSchedules.count()).toBe(1);
    await installPack(makePack("uninstalled.pack"));
    expect((await db.userStates.get(["uninstalled.pack", questionId]))?.status).toBe("mastered");
  });

  it("preserves newer attempts when merging an old backup and compares time zones chronologically", async () => {
    await installPack(makePack());
    await recordAttempt(attemptInput(), new Date("2026-09-15T10:00:00Z"));
    const older = await createProgressBackup();
    await recordAttempt(attemptInput(), new Date("2026-09-16T10:00:00Z"));
    await importProgressBackup(JSON.stringify(older));
    expect((await db.reviewSchedules.get(["practice.pack", questionId]))?.intervalDays).toBe(3);
    await db.userStates.put({ packId: "practice.pack", questionId, favorite: true, status: "new", updatedAt: "2026-09-15T10:00:00Z" });
    await importProgressBackup(JSON.stringify({ schemaVersion: 1, states: [{ packId: "practice.pack", questionId, favorite: false, status: "review", updatedAt: "2026-09-15T19:00:00+08:00" }] }));
    expect((await db.userStates.get(["practice.pack", questionId]))?.status).toBe("review");
  });

  it("rejects malformed or duplicate backup records atomically", async () => {
    await installPack(makePack());
    const collection = await createCollection("校验集合");
    await addToCollection(collection.id, "practice.pack", questionId);
    await recordAttempt(attemptInput(), new Date("2026-09-15T10:00:00Z"));
    const backup = await createProgressBackup();
    const corruptions = [
      (b: typeof backup) => { b.attempts.push(structuredClone(b.attempts[0])); },
      (b: typeof backup) => { b.members.push(structuredClone(b.members[0])); },
      (b: typeof backup) => { b.collections.push(structuredClone(b.collections[0])); },
      (b: typeof backup) => { b.schedules[0].dueOn = "2026-02-30"; },
      (b: typeof backup) => { b.schedules[0].dueOn = "2026-10-01"; },
      (b: typeof backup) => { b.schedules[0].packId = "other.pack"; },
      (b: typeof backup) => { b.members[0].collectionId = "missing"; },
      (b: typeof backup) => { b.attempts[0].attemptedAt = "invalid"; },
      (b: typeof backup) => { b.attempts[0].attemptedOn = "2020-01-01"; }
    ];
    for (const corrupt of corruptions) {
      const bad = structuredClone(backup); corrupt(bad);
      await expect(importProgressBackup(JSON.stringify(bad), "replace")).rejects.toThrow();
      expect(await db.recallAttempts.count()).toBe(1);
      expect(await db.collectionMembers.count()).toBe(1);
    }
    for (const raw of [null, [], { schemaVersion: 2 }, { schemaVersion: 1, states: [null] }]) await expect(importProgressBackup(JSON.stringify(raw), "replace")).rejects.toThrow();
    for (const status of [["new"], {}, true]) {
      await expect(importProgressBackup(JSON.stringify({ schemaVersion: 1, states: [{ packId: "p", questionId, status, favorite: false, updatedAt: "2026-09-15T10:00:00Z" }] }))).rejects.toThrow();
    }
  });

  it("rejects a reused attempt ID from another pack without touching either history", async () => {
    await installPack(makePack());
    await recordAttempt(attemptInput(), new Date("2026-09-15T10:00:00Z"));
    const backup = await createProgressBackup();
    backup.attempts[0].packId = "other.pack";
    backup.schedules = schedulesFromAttempts(backup.attempts);
    await expect(importProgressBackup(JSON.stringify(backup))).rejects.toThrow("同一尝试标识");
    expect(await db.recallAttempts.count()).toBe(1);
    expect(await db.reviewSchedules.get(["other.pack", questionId])).toBeUndefined();
  });

  it("keeps all personal data by default, and explicit purge removes only the chosen pack", async () => {
    await installPack(makePack()); await installPack(makePack("other.pack"));
    const collection = await createCollection("两个题库");
    for (const packId of ["practice.pack", "other.pack"]) {
      await addToCollection(collection.id, packId, questionId);
      await recordAttempt(attemptInput(packId), new Date("2026-09-15T10:00:00Z"));
      await updateUserState(packId, questionId, { favorite: true });
    }
    await removePack("practice.pack");
    expect(await db.recallAttempts.count()).toBe(2);
    expect(await db.collectionMembers.count()).toBe(2);
    await installPack(makePack());
    await removePack("practice.pack", "true" as unknown as boolean);
    expect(await db.recallAttempts.count()).toBe(2);
    await installPack(makePack());
    expect(await db.reviewSchedules.get(["practice.pack", questionId])).toBeTruthy();
    await removePack("practice.pack", true);
    expect(await db.userStates.where("packId").equals("practice.pack").count()).toBe(0);
    expect(await db.recallAttempts.where("packId").equals("practice.pack").count()).toBe(0);
    expect(await db.reviewSchedules.get(["practice.pack", questionId])).toBeUndefined();
    expect(await db.collectionMembers.where("packId").equals("practice.pack").count()).toBe(0);
    expect(await db.studyCollections.count()).toBe(1);
    expect(await db.recallAttempts.where("packId").equals("other.pack").count()).toBe(1);
    expect(await db.collectionMembers.where("packId").equals("other.pack").count()).toBe(1);
  });

  it("keeps every personal record when an upgrade removes and later restores a stable question", async () => {
    const pack = makePack();
    await installPack(pack);
    const collection = await createCollection("版本往返");
    await addToCollection(collection.id, pack.pack.id, questionId);
    await recordAttempt(attemptInput(), new Date("2026-09-15T10:00:00Z"));
    await updateUserState(pack.pack.id, questionId, { favorite: true, status: "mastered" });
    const before = await createProgressBackup();
    const upgrade = structuredClone(pack);
    upgrade.pack.version = "2.0.0";
    upgrade.questions = upgrade.questions.filter((question) => question.id !== questionId);
    upgrade.pack.questionCount = upgrade.questions.length;
    await installPack(upgrade);
    expect(await db.questions.get([pack.pack.id, questionId])).toBeUndefined();
    await installPack(pack);
    const after = await createProgressBackup();
    expect({ ...after, exportedAt: "ignored" }).toEqual({ ...before, exportedAt: "ignored" });
  });
});
