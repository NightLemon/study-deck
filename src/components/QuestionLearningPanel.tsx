import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { db } from "../lib/db";
import { addToCollection, createCollection, recordAttempt } from "../lib/learning-service";
import type { StoredQuestion } from "../lib/types";

export const QuestionLearningPanel = ({ question, assistanceUsed, onBeginAttempt }: {
  question: StoredQuestion;
  assistanceUsed: boolean;
  onBeginAttempt: () => void;
}) => {
  const collections = useLiveQuery(() => db.studyCollections.orderBy("name").toArray(), []) ?? [];
  const schedule = useLiveQuery(() => db.reviewSchedules.get([question.packId, question.id]), [question.packId, question.id]);
  const [collectionId, setCollectionId] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [showAttempt, setShowAttempt] = useState(false);
  const [answer, setAnswer] = useState("");
  const [usedHint, setUsedHint] = useState(false);
  const [assessment, setAssessment] = useState<"correct" | "incorrect">("incorrect");
  const [mistakeReason, setMistakeReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : "保存失败，请重试"); }
    finally { setBusy(false); }
  };

  return <section className="question-learning" aria-label="集合与闭卷尝试">
    <div className="collection-save">
      <label>目标集合
        <select aria-label="目标集合" value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>
          <option value="">新建集合</option>
          {collections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {!collectionId && <label>集合名称<input aria-label="集合名称" maxLength={80} placeholder="例如：Agent 面试重点" value={collectionName} onChange={(event) => setCollectionName(event.target.value)} /></label>}
      <button className="button quiet" disabled={busy || (!collectionId && !collectionName.trim())} onClick={() => void perform(async () => {
        const selected = collectionId || (await createCollection(collectionName)).id;
        setCollectionId(selected);
        await addToCollection(selected, question.packId, question.id);
        setNotice("已加入集合；同一题不会重复添加。");
      })}>加入集合</button>
    </div>
    <div className="attempt-entry">
      {!showAttempt && <button className="button quiet" onClick={() => {
        onBeginAttempt(); setUsedHint(false); setAnswer(""); setMistakeReason(""); setEvidence(""); setAssessment("incorrect");
        setShowAttempt(true); setNotice(""); setError("");
      }}>开始闭卷尝试</button>}
      <Link to="/learning">查看学习记录</Link>
      {schedule && <span>下次复习：{schedule.dueOn} · 间隔 {schedule.intervalDays} 天（自评）</span>}
    </div>
    {showAttempt && <form className="attempt-form" onSubmit={(event) => {
      event.preventDefault();
      void perform(async () => {
        const next = await recordAttempt({ packId: question.packId, questionId: question.id, answer,
          usedHint: usedHint || assistanceUsed, selfAssessment: assessment, mistakeReason, evidence });
        setShowAttempt(false); setAnswer(""); setMistakeReason(""); setEvidence(""); setAssessment("incorrect");
        setNotice(`尝试已保存，下次复习：${next.dueOn}。这是自评记录，不是自动评分。`);
      });
    }}>
      <h3>先写下回答，再自评</h3>
      <p>本页已收起提示和答案。若在本次尝试中查看了提示、答案、拓展或原文，会记录为使用辅助内容。</p>
      <label>闭卷回答<textarea required maxLength={30000} rows={5} value={answer} onChange={(event) => setAnswer(event.target.value)} /></label>
      <label className="checkbox-label"><input type="checkbox" checked={usedHint || assistanceUsed} disabled={assistanceUsed} onChange={(event) => setUsedHint(event.target.checked)} />本次使用了提示或看过参考内容</label>
      {assistanceUsed && <small>已记录本次查看的辅助内容，收起后仍会保留此标记。</small>}
      <label>自评结果<select aria-label="自评结果" value={assessment} onChange={(event) => setAssessment(event.target.value as "correct" | "incorrect")}>
        <option value="incorrect">答错或不完整</option><option value="correct">回答正确</option>
      </select></label>
      <label>错因或补充说明{assessment === "incorrect" ? "（必填）" : "（选填）"}<textarea required={assessment === "incorrect"} maxLength={4000} rows={2} value={mistakeReason} onChange={(event) => setMistakeReason(event.target.value)} /></label>
      <label>实践证据（链接或文字，选填）<textarea maxLength={10000} rows={2} placeholder="例如：练习代码路径、测试结果、PR 链接" value={evidence} onChange={(event) => setEvidence(event.target.value)} /></label>
      <p>只有自评正确且未使用提示的尝试，才按 1 / 3 / 7 / 14 天延长间隔；其余情况回到 1 天。不会改变原有掌握标记。</p>
      <div className="row-actions"><button className="button primary" disabled={busy}>保存尝试</button><button className="button quiet" type="button" disabled={busy} onClick={() => setShowAttempt(false)}>暂不记录</button></div>
    </form>}
    {notice && <p className="learning-notice" role="status">{notice}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
  </section>;
};
