import MiniSearch from "minisearch";
import { resolveContent, type StoredQuestion } from "./types";

interface SearchDocument {
  id: string;
  prompt: string;
  interpretation: string;
  knowledge: string;
  answer: string;
  extension: string;
  quickAnswer: string;
}

export const createQuestionSearch = (questions: StoredQuestion[]) => {
  const search = new MiniSearch<SearchDocument>({
    fields: ["prompt", "interpretation", "knowledge", "answer", "extension", "quickAnswer"],
    storeFields: ["id"],
    searchOptions: { boost: { prompt: 4, quickAnswer: 2 }, fuzzy: 0.15, prefix: true }
  });
  const documents = questions.map((question) => ({
      id: question.id,
      ...resolveContent(question),
      quickAnswer: question.revision?.quickAnswer ?? ""
    }));
  search.addAll(documents);

  const plainText = new Map(
    documents.map((document) => [
      document.id,
      [document.prompt, document.interpretation, document.knowledge, document.answer, document.extension, document.quickAnswer]
        .join("\n")
        .toLocaleLowerCase()
    ])
  );

  return {
    search(query: string) {
      const miniResults = search.search(query);
      const seen = new Set(miniResults.map((result) => String(result.id)));
      const normalizedQuery = query.trim().toLocaleLowerCase();
      const directResults = normalizedQuery
        ? questions
            .filter((question) => !seen.has(question.id) && plainText.get(question.id)?.includes(normalizedQuery))
            .map((question) => ({ id: question.id, score: 0 }))
        : [];
      return [...miniResults, ...directResults];
    }
  };
};
