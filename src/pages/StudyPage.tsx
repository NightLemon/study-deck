import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useSearchParams } from "react-router-dom";
import { useApp } from "../App";
import { MarkdownContent } from "../components/MarkdownContent";
import { db } from "../lib/db";
import { updateUserState } from "../lib/progress-service";
import { createQuestionSearch } from "../lib/search";
import { resolveContent, type LearningStatus, type StoredQuestion, type UserState } from "../lib/types";

const statusLabels: Record<LearningStatus, string> = { new: "未学", review: "待复习", mastered: "已掌握" };
const reviewLabels = { raw: "原始抽取", reviewed: "已校订", verified: "已确认" } as const;

const QuestionCard = ({
  question,
  state,
  onChange
}: {
  question: StoredQuestion;
  state?: UserState;
  onChange: (patch: Partial<Pick<UserState, "favorite" | "status">>) => Promise<void>;
}) => {
  const [showHint, setShowHint] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [showExtension, setShowExtension] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const content = resolveContent(question);
  const favorite = state?.favorite ?? false;
  const status = state?.status ?? "new";

  return (
    <article className="question-card" id={`question-${question.id}`}>
      <div className="question-meta">
        <span className="question-id">{question.id}</span>
        <span className={`review-badge ${question.review.status}`}>{reviewLabels[question.review.status]}</span>
        <span className="source-page">PDF {question.sourcePages[0]}-{question.sourcePages[1]} 页</span>
        <button
          className={`favorite ${favorite ? "on" : ""}`}
          aria-label={favorite ? "取消收藏" : "收藏题目"}
          aria-pressed={favorite}
          onClick={() => void onChange({ favorite: !favorite })}
        >{favorite ? "★" : "☆"}</button>
      </div>
      <MarkdownContent>{content.prompt}</MarkdownContent>

      <div className="recall-actions">
        <button className={showHint ? "active" : ""} onClick={() => setShowHint((value) => !value)}>
          <span>01</span>{showHint ? "收起提示" : "查看提示"}
        </button>
        <button className={showAnswer ? "active" : ""} onClick={() => setShowAnswer((value) => !value)}>
          <span>02</span>{showAnswer ? "收起答案" : "揭示答案"}
        </button>
        <button className={showExtension ? "active" : ""} onClick={() => setShowExtension((value) => !value)}>
          <span>03</span>{showExtension ? "收起拓展" : "拓展与追问"}
        </button>
      </div>

      {showHint && (
        <section className="reveal-panel hint-panel">
          <div><h4>题目解读</h4><MarkdownContent>{content.interpretation || "暂无题目解读。"}</MarkdownContent></div>
          <div><h4>知识点</h4><MarkdownContent>{content.knowledge || "暂无知识点。"}</MarkdownContent></div>
        </section>
      )}

      {showAnswer && (
        <section className="reveal-panel answer-panel">
          {question.revision?.quickAnswer && (
            <div className="quick-answer"><span>30 秒回答</span><MarkdownContent>{question.revision.quickAnswer}</MarkdownContent></div>
          )}
          <h4>参考答案</h4>
          <MarkdownContent>{content.answer || "此题答案尚待整理。"}</MarkdownContent>
          {question.revision?.pitfalls && <><h4>常见误区</h4><MarkdownContent>{question.revision.pitfalls}</MarkdownContent></>}
        </section>
      )}

      {showExtension && (
        <section className="reveal-panel extension-panel">
          <h4>拓展思考</h4>
          <MarkdownContent>{content.extension || "暂无拓展内容。"}</MarkdownContent>
          {(question.revision?.followUps?.length ?? 0) > 0 && (
            <><h4>面试追问</h4><ul>{question.revision!.followUps!.map((item) => <li key={item}>{item}</li>)}</ul></>
          )}
          {(question.revision?.references?.length ?? 0) > 0 && (
            <><h4>参考资料</h4><ul className="reference-list">{question.revision!.references!.map((reference) => (
              <li key={reference.url}><a href={reference.url} target="_blank" rel="noreferrer noopener">{reference.title}</a></li>
            ))}</ul></>
          )}
        </section>
      )}

      {(question.revision || question.review.notes?.length) && (
        <div className="original-row">
          <button className="text-button" onClick={() => setShowOriginal((value) => !value)}>
            {showOriginal ? "收起原文对照" : "查看 PDF 原文与修订说明"}
          </button>
          {showOriginal && (
            <div className="original-panel">
              <h4>规范化后的 PDF 原文</h4>
              <MarkdownContent>{question.original.prompt}</MarkdownContent>
              <details><summary>题目解读</summary><MarkdownContent>{question.original.interpretation}</MarkdownContent></details>
              <details><summary>知识点</summary><MarkdownContent>{question.original.knowledge}</MarkdownContent></details>
              <details><summary>答案</summary><MarkdownContent>{question.original.answer}</MarkdownContent></details>
              {question.review.notes?.length ? <ul>{question.review.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
            </div>
          )}
        </div>
      )}

      <div className="question-footer">
        <span>这道题：</span>
        {(Object.keys(statusLabels) as LearningStatus[]).map((item) => (
          <button
            key={item}
            className={status === item ? `status-${item} active` : ""}
            onClick={() => void onChange({ status: item })}
          >{statusLabels[item]}</button>
        ))}
      </div>
    </article>
  );
};

export const StudyPage = () => {
  const { activePackId } = useApp();
  const [params, setParams] = useSearchParams();
  const pack = useLiveQuery(() => activePackId ? db.packs.get(activePackId) : undefined, [activePackId]);
  const questions = useLiveQuery(
    () => activePackId ? db.questions.where("packId").equals(activePackId).sortBy("order") : [],
    [activePackId]
  ) ?? [];
  const states = useLiveQuery(
    () => activePackId ? db.userStates.where("packId").equals(activePackId).toArray() : [],
    [activePackId]
  ) ?? [];
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | LearningStatus>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [limit, setLimit] = useState(30);
  const [curriculumOpen, setCurriculumOpen] = useState(false);
  const chapterFilter = params.get("chapter") ?? "all";
  const sectionFilter = params.get("section") ?? "all";
  const stateMap = useMemo(() => new Map(states.map((state) => [state.questionId, state])), [states]);
  const search = useMemo(() => createQuestionSearch(questions), [questions]);

  useEffect(() => setLimit(30), [query, statusFilter, favoritesOnly, chapterFilter, sectionFilter]);

  const filteredQuestions = useMemo(() => {
    const matchingIds = query.trim() ? new Set(search.search(query.trim()).map((result) => String(result.id))) : null;
    return questions.filter((question) => {
      const state = stateMap.get(question.id);
      if (matchingIds && !matchingIds.has(question.id)) return false;
      if (chapterFilter !== "all" && question.chapterId !== chapterFilter) return false;
      if (sectionFilter !== "all" && question.sectionId !== sectionFilter) return false;
      if (favoritesOnly && !state?.favorite) return false;
      if (statusFilter !== "all" && (state?.status ?? "new") !== statusFilter) return false;
      return true;
    });
  }, [chapterFilter, favoritesOnly, query, questions, search, sectionFilter, stateMap, statusFilter]);

  if (!pack) {
    return <section className="empty-state"><h1>先导入一个题库</h1><p>学习页需要本地题库数据。</p><Link className="button primary" to="/packs">前往题库管理</Link></section>;
  }

  const selectChapter = (chapterId: string) => {
    setParams(chapterId === "all" ? {} : { chapter: chapterId });
    setCurriculumOpen(false);
  };
  const selectSection = (chapterId: string, sectionId: string) => {
    setParams({ chapter: chapterId, section: sectionId });
    setCurriculumOpen(false);
  };

  return (
    <div className="study-layout">
      {curriculumOpen && (
        <button className="curriculum-backdrop" aria-label="关闭章节目录" onClick={() => setCurriculumOpen(false)} />
      )}
      <aside id="curriculum-drawer" className={`curriculum ${curriculumOpen ? "open" : ""}`} aria-label="章节目录">
        <div className="curriculum-title">
          <span>课程目录</span><strong>{questions.length} 题</strong>
          <button className="curriculum-close" aria-label="关闭章节目录" onClick={() => setCurriculumOpen(false)}>×</button>
        </div>
        <button className={chapterFilter === "all" ? "active" : ""} onClick={() => selectChapter("all")}>全部题目</button>
        {pack.chapters.map((chapter) => (
          <details key={chapter.id} open={chapterFilter === chapter.id}>
            <summary>
              <button className={chapterFilter === chapter.id && sectionFilter === "all" ? "active" : ""} onClick={() => selectChapter(chapter.id)}>
                <span>{chapter.id.padStart(2, "0")}</span>{chapter.title}
              </button>
            </summary>
            <div>
              {chapter.sections.map((section) => (
                <button key={section.id} className={sectionFilter === section.id ? "active" : ""} onClick={() => selectSection(chapter.id, section.id)}>
                  <span>{section.id}</span>{section.title}
                </button>
              ))}
            </div>
          </details>
        ))}
      </aside>

      <div className="study-main">
        <section className="study-toolbar">
          <button
            className="curriculum-mobile-button"
            aria-controls="curriculum-drawer"
            aria-expanded={curriculumOpen}
            onClick={() => setCurriculumOpen(true)}
          >☰ 章节目录</button>
          <div className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题目、答案或知识点" aria-label="搜索题库" /></div>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | LearningStatus)} aria-label="按学习状态筛选">
            <option value="all">全部状态</option><option value="new">未学</option><option value="review">待复习</option><option value="mastered">已掌握</option>
          </select>
          <button className={favoritesOnly ? "filter-toggle active" : "filter-toggle"} onClick={() => setFavoritesOnly((value) => !value)}>★ 只看收藏</button>
        </section>

        <div className="result-heading"><div><span className="eyebrow">ACTIVE RECALL</span><h1>{query ? `搜索“${query}”` : "主动回忆"}</h1></div><strong>{filteredQuestions.length} 道题</strong></div>

        <div className="question-list">
          {filteredQuestions.slice(0, limit).map((question) => (
            <QuestionCard
              key={question.id}
              question={question}
              state={stateMap.get(question.id)}
              onChange={async (patch) => { await updateUserState(question.packId, question.id, patch); }}
            />
          ))}
          {filteredQuestions.length === 0 && <div className="subtle-empty">没有符合当前筛选条件的题目。</div>}
          {limit < filteredQuestions.length && <button className="button load-more" onClick={() => setLimit((value) => value + 30)}>再显示 30 题</button>}
        </div>
      </div>
    </div>
  );
};
