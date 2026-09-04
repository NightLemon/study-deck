import { db } from "./db";
import type { LearningStatus, ProgressBackup, UserState } from "./types";

const isLearningStatus = (value: unknown): value is LearningStatus =>
  value === "new" || value === "review" || value === "mastered";

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

export const createProgressBackup = async (): Promise<ProgressBackup> => ({
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  states: await db.userStates.toArray()
});

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
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("进度备份不是有效的 JSON");
  }

  const backup = data as Partial<ProgressBackup>;
  if (backup.schemaVersion !== 1 || !Array.isArray(backup.states)) {
    throw new Error("不支持的进度备份格式");
  }

  const states = backup.states.map((state) => {
    if (
      !state ||
      typeof state.packId !== "string" ||
      typeof state.questionId !== "string" ||
      typeof state.favorite !== "boolean" ||
      !isLearningStatus(state.status) ||
      typeof state.updatedAt !== "string"
    ) {
      throw new Error("进度备份包含无效记录");
    }
    return state;
  });

  await db.transaction("rw", db.userStates, async () => {
    if (mode === "replace") await db.userStates.clear();
    for (const incoming of states) {
      const existing = await db.userStates.get([incoming.packId, incoming.questionId]);
      if (mode === "replace" || !existing || incoming.updatedAt > existing.updatedAt) {
        await db.userStates.put(incoming);
      }
    }
  });

  return states.length;
};
