import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { importProgressBackup } from "./progress-service";

describe("progress backup", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it("merges by updatedAt", async () => {
    await db.userStates.put({ packId: "p", questionId: "1.1.1", favorite: false, status: "new", updatedAt: "2026-01-02T00:00:00Z" });
    await importProgressBackup(JSON.stringify({
      schemaVersion: 1,
      exportedAt: "2026-01-03T00:00:00Z",
      states: [{ packId: "p", questionId: "1.1.1", favorite: true, status: "mastered", updatedAt: "2026-01-01T00:00:00Z" }]
    }));
    expect((await db.userStates.get(["p", "1.1.1"]))?.favorite).toBe(false);
  });

  it("replaces all state when requested", async () => {
    await db.userStates.put({ packId: "old", questionId: "1.1.1", favorite: true, status: "review", updatedAt: "2026-01-01T00:00:00Z" });
    await importProgressBackup(JSON.stringify({
      schemaVersion: 1,
      exportedAt: "2026-01-03T00:00:00Z",
      states: [{ packId: "new", questionId: "2.1.1", favorite: false, status: "new", updatedAt: "2026-01-03T00:00:00Z" }]
    }), "replace");
    expect(await db.userStates.count()).toBe(1);
    expect(await db.userStates.get(["new", "2.1.1"])).toBeTruthy();
  });

  it("accepts a newer record while leaving other packs isolated", async () => {
    await db.userStates.bulkPut([
      { packId: "p", questionId: "1.1.1", favorite: false, status: "new", updatedAt: "2026-01-01T00:00:00Z" },
      { packId: "other", questionId: "1.1.1", favorite: true, status: "review", updatedAt: "2026-01-01T00:00:00Z" }
    ]);
    await importProgressBackup(JSON.stringify({
      schemaVersion: 1,
      exportedAt: "2026-01-03T00:00:00Z",
      states: [{ packId: "p", questionId: "1.1.1", favorite: true, status: "mastered", updatedAt: "2026-01-02T00:00:00Z" }]
    }));
    expect((await db.userStates.get(["p", "1.1.1"]))?.status).toBe("mastered");
    expect((await db.userStates.get(["other", "1.1.1"]))?.status).toBe("review");
  });

  it("does not mutate existing progress when validation fails", async () => {
    await db.userStates.put({ packId: "p", questionId: "1.1.1", favorite: true, status: "review", updatedAt: "2026-01-01T00:00:00Z" });
    await expect(importProgressBackup(JSON.stringify({
      schemaVersion: 1,
      states: [{ packId: "p", questionId: "1.1.2", favorite: "yes", status: "new", updatedAt: "2026-01-02T00:00:00Z" }]
    }), "replace")).rejects.toThrow("无效记录");
    expect(await db.userStates.count()).toBe(1);
    expect(await db.userStates.get(["p", "1.1.1"])).toBeTruthy();
  });
});
