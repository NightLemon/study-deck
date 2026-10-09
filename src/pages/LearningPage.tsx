import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { db } from "../lib/db";
import { createCollection, localDate, questionKey, removeCollection, removeFromCollection } from "../lib/learning-service";
import { resolveContent } from "../lib/types";

export const LearningPage = () => {
  const collections = useLiveQuery(() => db.studyCollections.orderBy("name").toArray(), []) ?? [];
  const members = useLiveQuery(() => db.collectionMembers.toArray(), []) ?? [];
  const attempts = useLiveQuery(() => db.recallAttempts.orderBy("attemptedAt").reverse().toArray(), []) ?? [];
  const schedules = useLiveQuery(() => db.reviewSchedules.orderBy("dueOn").toArray(), []) ?? [];
  const packs = useLiveQuery(() => db.packs.toArray(), []) ?? [];
  const questions = useLiveQuery(() => db.questions.toArray(), []) ?? [];
  const [tab, setTab] = useState<"due" | "collections" | "attempts">("due");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [today, setToday] = useState(localDate());
  useEffect(() => { const timer = setInterval(() => setToday(localDate()), 60000); return () => clearInterval(timer); }, []);
  const questionMap = useMemo(() => new Map(questions.map((item) => [questionKey(item.packId, item.id), item])), [questions]);
  const packMap = useMemo(() => new Map(packs.map((item) => [item.id, item.info.title])), [packs]);
  const due = schedules.filter((item) => item.dueOn <= today);
  const act = async (action: () => Promise<unknown>) => {
    setError("");
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : "操作失败，请重试"); }
  };
  const reference = (packId: string, questionId: string) => {
    const question = questionMap.get(questionKey(packId, questionId));
    return <div className="learning-reference">
      <small>{packMap.get(packId) ?? `未安装题库：${packId}`} · {questionId}</small>
      {question ? <><p>{resolveContent(question).prompt.slice(0, 180)}</p><Link className="text-button" to={`/study?${new URLSearchParams({ pack: packId, question: questionId })}`}>打开这道题 →</Link></>
        : <p>题目尚未安装，个人记录已保留。导入相同题库及题号后即可继续。</p>}
    </div>;
  };

  return <div className="page-width learning-page">
    <div className="page-title"><div><span className="eyebrow">PERSONAL PRACTICE</span><h1>集合与复习</h1></div></div>
    <p>集合只保存题目引用；回答与复习安排留在当前浏览器。这里的结果来自个人自评，不代表自动评分或已验证掌握。</p>
    <div className="learning-tabs" role="tablist" aria-label="学习记录视图">
      <button role="tab" aria-selected={tab === "due"} onClick={() => setTab("due")}>到期复习（{due.length}）</button>
      <button role="tab" aria-selected={tab === "collections"} onClick={() => setTab("collections")}>目标集合（{collections.length}）</button>
      <button role="tab" aria-selected={tab === "attempts"} onClick={() => setTab("attempts")}>尝试记录（{attempts.length}）</button>
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {tab === "due" && <section className="learning-list" aria-label="到期复习列表">
      <p>今天：{today}，按设备本地日期计算。独立正确依次使用 1 / 3 / 7 / 14 天间隔，使用提示或答错后回到 1 天。</p>
      {due.length === 0 && <div className="subtle-empty"><h2>今天没有到期题目</h2><p>{schedules.length ? `已有 ${schedules.length} 道题安排了后续复习。` : "先到学习页完成一次闭卷尝试，保存自评后会出现复习日期。"}</p><Link to="/study">前往学习</Link></div>}
      {due.map((item) => <article className="learning-item" key={questionKey(item.packId, item.questionId)}>
        <strong>{item.dueOn < today ? "已逾期" : "今天到期"} · {item.dueOn}</strong>
        {reference(item.packId, item.questionId)}
        <small>上次间隔 {item.intervalDays} 天 · 连续独立正确 {item.independentStreak} 次（最多记 4 次）</small>
      </article>)}
      {schedules.some((item) => item.dueOn > today) && <details className="upcoming-reviews"><summary>查看后续复习安排</summary>
        {schedules.filter((item) => item.dueOn > today).map((item) => <article className="learning-item" key={questionKey(item.packId, item.questionId)}><strong>{item.dueOn}</strong>{reference(item.packId, item.questionId)}</article>)}
      </details>}
    </section>}
    {tab === "collections" && <section aria-label="目标集合列表">
      <form className="collection-create" onSubmit={(event) => { event.preventDefault(); void act(async () => { await createCollection(name); setName(""); }); }}>
        <label>新集合名称<input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：本周练习" /></label>
        <button className="button primary">新建集合</button>
      </form>
      {collections.length === 0 && <div className="subtle-empty">还没有目标集合。可以在这里新建，再从学习页把题目加入集合。</div>}
      {collections.map((collection) => {
        const selected = members.filter((item) => item.collectionId === collection.id);
        return <article className="collection-card" key={collection.id}>
          <div className="section-heading"><h2>{collection.name}</h2><button className="danger-link" onClick={() => {
            if (confirm(`删除集合「${collection.name}」？尝试和复习安排仍会保留。`)) void act(() => removeCollection(collection.id));
          }}>删除集合</button></div>
          <p>{selected.length} 道题 · 可以包含不同题库中的题目</p>
          {selected.length === 0 && <p>集合还是空的。到学习页选择题目，点击“加入集合”。</p>}
          {selected.map((member) => <div className="learning-item" key={questionKey(member.packId, member.questionId)}>{reference(member.packId, member.questionId)}
            <button className="text-button" onClick={() => void act(() => removeFromCollection(collection.id, member.packId, member.questionId))}>移出集合</button>
          </div>)}
        </article>;
      })}
    </section>}
    {tab === "attempts" && <section className="learning-list" aria-label="尝试记录列表">
      {attempts.length === 0 && <div className="subtle-empty">还没有尝试记录。到学习页点击“开始闭卷尝试”，先写回答，再保存自评。</div>}
      {attempts.map((attempt) => <article className="learning-item" key={attempt.id}>
        <strong>{attempt.attemptedOn} · {attempt.selfAssessment === "correct" ? "自评正确" : "自评答错或不完整"} · {attempt.usedHint ? "使用了提示或参考内容" : "自报未使用提示"}</strong>
        {reference(attempt.packId, attempt.questionId)}
        <details><summary>查看回答、错因与实践证据</summary>
          <h3>当时的回答</h3><p className="personal-text">{attempt.answer}</p>
          {attempt.mistakeReason && <><h3>错因或补充说明</h3><p className="personal-text">{attempt.mistakeReason}</p></>}
          <h3>实践证据</h3><p className="personal-text">{attempt.evidence || "本次未填写实践证据。"}</p>
        </details>
      </article>)}
    </section>}
  </div>;
};
