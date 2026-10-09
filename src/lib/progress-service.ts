import { db } from "./db";
import { validateBackup } from "./backup-validation";
import { schedulesFromAttempts } from "./learning-service";
import type { ProgressBackup, UserState } from "./types";

export const getUserState = async (packId: string, questionId: string): Promise<UserState> =>
  (await db.userStates.get([packId, questionId])) ?? {
    packId,
    questionId,
    favorite: false,
    status: "new",
    updatedAt: new Date(0).toISOString()
  };

export const updateUserState = async (
  packId: string,
  questionId: string,
  patch: Partial<Pick<UserState, "favorite" | "status" | "lastViewedAt">>
) => {
  const previous = await getUserState(packId, questionId);
  const next: UserState = {
    ...previous,
    ...patch,
    packId,
    questionId,
    updatedAt: new Date().toISOString()
  };
  await db.userStates.put(next);
  return next;
};

const personalTables = () => [db.userStates, db.studyCollections, db.collectionMembers, db.recallAttempts, db.reviewSchedules];

export const createProgressBackup = async (): Promise<ProgressBackup> => db.transaction("r", personalTables(), async () => ({
  schemaVersion: 2,
  exportedAt: new Date().toISOString(),
  states: await db.userStates.toArray(),
  collections: await db.studyCollections.toArray(),
  members: await db.collectionMembers.toArray(),
  attempts: await db.recallAttempts.toArray(),
  schedules: await db.reviewSchedules.toArray()
}));

export const downloadProgressBackup = async () => {
  const backup = await createProgressBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `study-deck-progress-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
};

export const importProgressBackup = async (text: string, mode: "merge" | "replace" = "merge") => {
  if (mode !== "merge" && mode !== "replace") throw new Error("进度导入模式无效");
  if (new TextEncoder().encode(text).length > 25 * 1024 * 1024) throw new Error("进度备份超过 25 MB 限制");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("进度备份不是有效的 JSON");
  }

  const backup = validateBackup(data);
  await db.transaction("rw", personalTables(), async () => {
    if (mode === "replace") {
      // A v1 backup has no new tables: replacing it replaces legacy state only.
      if (backup.schemaVersion === 1) await db.userStates.clear();
      else for (const table of personalTables()) await table.clear();
    }
    for (const incoming of backup.states) {
      const existing = await db.userStates.get([incoming.packId, incoming.questionId]);
      if (mode === "replace" || !existing || Date.parse(incoming.updatedAt) > Date.parse(existing.updatedAt)) {
        await db.userStates.put(incoming);
      }
    }
    if (backup.schemaVersion === 2) {
      for (const incoming of backup.collections) {
        const existing = await db.studyCollections.get(incoming.id);
        if (!existing || Date.parse(incoming.updatedAt) > Date.parse(existing.updatedAt)) await db.studyCollections.put(incoming);
      }
      const collections = await db.studyCollections.toArray();
      if (new Set(collections.map((item) => item.name.toLowerCase())).size !== collections.length) throw new Error("备份与本地存在不同标识的同名集合，请检查备份并保留需要的数据后再导入");
      for (const incoming of backup.members) {
        if (!await db.collectionMembers.get([incoming.collectionId, incoming.packId, incoming.questionId])) await db.collectionMembers.add(incoming);
      }
      for (const incoming of backup.attempts) {
        const existing = await db.recallAttempts.get(incoming.id);
        if (existing && (Object.keys(incoming) as (keyof typeof incoming)[]).some((key) => incoming[key] !== existing[key])) {
          throw new Error("同一尝试标识对应了不同内容，已取消导入");
        }
        if (!existing) await db.recallAttempts.add(incoming);
      }
      // Merge histories first, then derive schedules; an older backup cannot overwrite
      // a newer attempt's due date, and identical question IDs stay pack-scoped.
      const mergedSchedules = schedulesFromAttempts(await db.recallAttempts.toArray());
      await db.reviewSchedules.clear();
      await db.reviewSchedules.bulkPut(mergedSchedules);
    }
  });

  return backup.states.length + (backup.schemaVersion === 2 ? backup.collections.length + backup.members.length + backup.attempts.length + backup.schedules.length : 0);
};
