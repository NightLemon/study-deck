import Dexie, { type EntityTable, type Table } from "dexie";
import type { StoredPack, StoredQuestion, UserState } from "./types";

export class StudyDatabase extends Dexie {
  packs!: EntityTable<StoredPack, "id">;
  questions!: Table<StoredQuestion, [string, string]>;
  userStates!: Table<UserState, [string, string]>;

  constructor(name = "qd-study") {
    super(name);
    this.version(1).stores({
      packs: "id, updatedAt",
      questions: "[packId+id], packId, chapterId, sectionId, review.status",
      userStates: "[packId+questionId], packId, favorite, status, updatedAt"
    });
    this.version(2).stores({
      packs: "id, installedAt, updatedAt",
      questions: "[packId+id], packId, chapterId, sectionId, review.status",
      userStates: "[packId+questionId], packId, favorite, status, updatedAt"
    });
  }
}

export const db = new StudyDatabase();
