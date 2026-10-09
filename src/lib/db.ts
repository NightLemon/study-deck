import Dexie, { type EntityTable, type Table } from "dexie";
import type { CollectionMember, RecallAttempt, ReviewSchedule, StoredPack, StoredQuestion, StudyCollection, UserState } from "./types";

export class StudyDatabase extends Dexie {
  packs!: EntityTable<StoredPack, "id">;
  questions!: Table<StoredQuestion, [string, string]>;
  userStates!: Table<UserState, [string, string]>;
  studyCollections!: EntityTable<StudyCollection, "id">;
  collectionMembers!: Table<CollectionMember, [string, string, string]>;
  recallAttempts!: EntityTable<RecallAttempt, "id">;
  reviewSchedules!: Table<ReviewSchedule, [string, string]>;

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
    this.version(3).stores({
      packs: "id, installedAt, updatedAt",
      questions: "[packId+id], packId, chapterId, sectionId, review.status",
      userStates: "[packId+questionId], packId, favorite, status, updatedAt",
      studyCollections: "id, name, updatedAt",
      collectionMembers: "[collectionId+packId+questionId], collectionId, packId, [packId+questionId]",
      recallAttempts: "id, packId, [packId+questionId], attemptedAt",
      reviewSchedules: "[packId+questionId], packId, dueOn, updatedAt"
    });
  }
}

export const db = new StudyDatabase();
