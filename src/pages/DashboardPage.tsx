import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { useApp } from "../App";
import { db } from "../lib/db";

export const DashboardPage = () => {
  const { activePackId } = useApp();
  const pack = useLiveQuery(() => activePackId ? db.packs.get(activePackId) : undefined, [activePackId]);
  const questions = useLiveQuery(
    () => activePackId ? db.questions.where("packId").equals(activePackId).toArray() : [],
    [activePackId]
  ) ?? [];
  const states = useLiveQuery(
    () => activePackId ? db.userStates.where("packId").equals(activePackId).toArray() : [],
    [activePackId]
  ) ?? [];

  const stats = useMemo(() => {
    const stateMap = new Map(states.map((state) => [state.questionId, state]));
    const mastered = questions.filter((question) => stateMap.get(question.id)?.status === "mastered").length;
    const review = questions.filter((question) => stateMap.get(question.id)?.status === "review").length;
    const favorites = states.filter((state) => state.favorite).length;
    return { mastered, review, favorites, percent: questions.length ? Math.round(mastered / questions.length * 100) : 0 };
  }, [questions, states]);

  if (!pack) {
    return (
      <section className="empty-state hero-empty">
        <div className="eyebrow">LOCAL-FIRST · PRIVATE BY DESIGN</div>
        <h1>把复杂知识，变成每天可推进的一组题</h1>
        <p>导入本地 JSON 题库后，搜索、收藏、学习状态和答案都只留在你的设备上。</p>
        <Link className="button primary" to="/packs">导入第一个题库</Link>
      </section>
    );
  }

  return (
    <div className="dashboard page-width">
      <section className="dashboard-hero">
        <div>
          <div className="eyebrow">{pack.info.source.title} · {pack.info.version}</div>
          <h1>{pack.info.title}</h1>
          <p>{pack.info.description ?? "以主动回忆的方式训练量化开发与高性能系统知识。"}</p>
          <div className="hero-actions">
            <Link className="button primary" to="/study">继续学习</Link>
            <Link className="button quiet" to="/packs">管理题库</Link>
          </div>
        </div>
        <div className="progress-orbit" aria-label={`已掌握 ${stats.percent}%`}>
          <div className="progress-ring" style={{ "--progress": `${stats.percent * 3.6}deg` } as React.CSSProperties}>
            <span><strong>{stats.percent}%</strong><small>已掌握</small></span>
          </div>
        </div>
      </section>

      <section className="stat-grid" aria-label="学习统计">
        <article><span>题目总数</span><strong>{questions.length}</strong><small>{pack.chapters.length} 个章节</small></article>
        <article><span>已掌握</span><strong>{stats.mastered}</strong><small>持续巩固</small></article>
        <article><span>待复习</span><strong>{stats.review}</strong><small>优先回看</small></article>
        <article><span>已收藏</span><strong>{stats.favorites}</strong><small>重点题目</small></article>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div><span className="eyebrow">LEARNING MAP</span><h2>按章节推进</h2></div>
          <Link to="/study">查看全部题目 →</Link>
        </div>
        <div className="chapter-grid">
          {pack.chapters.map((chapter) => {
            const chapterQuestions = questions.filter((question) => question.chapterId === chapter.id);
            const chapterMastered = chapterQuestions.filter(
              (question) => states.find((state) => state.questionId === question.id)?.status === "mastered"
            ).length;
            const percent = chapterQuestions.length ? Math.round(chapterMastered / chapterQuestions.length * 100) : 0;
            return (
              <Link key={chapter.id} className="chapter-card" to={`/study?chapter=${chapter.id}`}>
                <span className="chapter-index">{chapter.id.padStart(2, "0")}</span>
                <div><h3>{chapter.title}</h3><p>{chapterQuestions.length} 题 · {chapter.sections.length} 节</p></div>
                <div className="mini-progress"><i style={{ width: `${percent}%` }} /></div>
                <strong>{percent}%</strong>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
};
