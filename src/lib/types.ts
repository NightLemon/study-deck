export type ReviewStatus = "raw" | "reviewed" | "verified";
export type LearningStatus = "new" | "review" | "mastered";

export interface ContentFields {
  prompt: string;
  interpretation: string;
  knowledge: string;
  answer: string;
  extension: string;
}

export interface Section {
  id: string;
  title: string;
  order: number;
}

export interface Chapter {
  id: string;
  title: string;
  order: number;
  sections: Section[];
}

export interface QuestionReference {
  title: string;
  url: string;
}

export interface Question {
  id: string;
  chapterId: string;
  sectionId: string;
  order: number;
  sourcePages?: [number, number];
  original: ContentFields;
  revision?: {
    fields?: Partial<ContentFields>;
    quickAnswer?: string;
    pitfalls?: string;
    followUps?: string[];
    references?: QuestionReference[];
  };
  review: {
    status: ReviewStatus;
    notes?: string[];
    updatedAt?: string;
  };
}

export interface PackInfo {
  id: string;
  title: string;
  description?: string;
  version: string;
  locale: "zh-CN";
  questionCount: number;
  createdAt?: string;
  license: {
    scope: "private-personal-use";
    redistribution: false;
    notice?: string;
  };
  source: {
    title: string;
    documentVersion: string;
  };
}

export interface QuestionPack {
  schemaVersion: 1;
  pack: PackInfo;
  chapters: Chapter[];
  questions: Question[];
}

export interface StoredPack {
  id: string;
  info: PackInfo;
  chapters: Chapter[];
  installedAt: string;
  updatedAt: string;
}

export interface StoredQuestion extends Question {
  packId: string;
}

export interface UserState {
  packId: string;
  questionId: string;
  favorite: boolean;
  status: LearningStatus;
  updatedAt: string;
  lastViewedAt?: string;
}

export interface ProgressBackup {
  schemaVersion: 1;
  exportedAt: string;
  states: UserState[];
}

export const resolveContent = (question: Question): ContentFields => ({
  ...question.original,
  ...question.revision?.fields
});
