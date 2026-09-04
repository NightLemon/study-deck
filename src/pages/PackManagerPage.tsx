import { useRef, useState, type DragEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useApp } from "../App";
import { db } from "../lib/db";
import { installPack, parsePackFile, parsePackText, removePack } from "../lib/pack-service";
import { downloadProgressBackup, importProgressBackup } from "../lib/progress-service";

type Notice = { kind: "success" | "error"; text: string } | null;

export const PackManagerPage = () => {
  const { activePackId, setActivePackId } = useApp();
  const packs = useLiveQuery(() => db.packs.orderBy("installedAt").toArray(), []) ?? [];
  const fileInput = useRef<HTMLInputElement>(null);
  const progressInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [backupMode, setBackupMode] = useState<"merge" | "replace">("merge");

  const importFile = async (file: File) => {
    setBusy(true);
    setNotice(null);
    try {
      const pack = await parsePackFile(file);
      await installPack(pack);
      setActivePackId(pack.pack.id);
      setNotice({ kind: "success", text: `已安装「${pack.pack.title}」${pack.pack.version}，共 ${pack.questions.length} 题。` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "导入失败" });
    } finally {
      setBusy(false);
    }
  };

  const importSample = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}sample-pack.json`);
      if (!response.ok) throw new Error("无法读取内置示例包");
      const pack = parsePackText(await response.text());
      await installPack(pack);
      setActivePackId(pack.pack.id);
      setNotice({ kind: "success", text: "合成示例题库已安装。" });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "示例包安装失败" });
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void importFile(file);
  };

  const onImportProgress = async (file: File) => {
    try {
      const count = await importProgressBackup(await file.text(), backupMode);
      setNotice({ kind: "success", text: `已${backupMode === "merge" ? "合并" : "覆盖"} ${count} 条学习记录。` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "进度导入失败" });
    }
  };

  return (
    <div className="page-width packs-page">
      <div className="page-title">
        <div><span className="eyebrow">QUESTION PACKS</span><h1>题库管理</h1></div>
      </div>

      {notice && <div role="status" className={`notice ${notice.kind}`}>{notice.text}</div>}

      <section className="manager-grid">
        <div
          className={`drop-zone ${dragging ? "dragging" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span className="drop-icon">↓</span>
          <h2>导入单文件 JSON 题库</h2>
          <p>支持题库格式 v1，文件上限 25 MB。导入前会完整校验，失败不会改变现有数据。</p>
          <div className="row-actions">
            <button className="button primary" disabled={busy} onClick={() => fileInput.current?.click()}>
              {busy ? "正在处理…" : "选择题库文件"}
            </button>
            <button className="button quiet" disabled={busy} onClick={() => void importSample()}>安装合成示例</button>
          </div>
          <input
            ref={fileInput}
            hidden
            type="file"
            accept="application/json,.json"
            onChange={(event) => event.target.files?.[0] && void importFile(event.target.files[0])}
          />
        </div>

        <aside className="progress-card">
          <h2>学习进度</h2>
          <p>导出或恢复收藏、掌握状态和复习记录。</p>
          <button className="text-button" onClick={() => void downloadProgressBackup()}>导出全部进度 →</button>
          <div className="backup-import">
            <select aria-label="进度导入模式" value={backupMode} onChange={(event) => setBackupMode(event.target.value as "merge" | "replace")}>
              <option value="merge">按时间合并</option>
              <option value="replace">完全覆盖</option>
            </select>
            <button className="text-button" onClick={() => progressInput.current?.click()}>导入进度</button>
            <input
              ref={progressInput}
              hidden
              type="file"
              accept="application/json,.json"
              onChange={(event) => event.target.files?.[0] && void onImportProgress(event.target.files[0])}
            />
          </div>
        </aside>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><span className="eyebrow">INSTALLED</span><h2>已安装题库</h2></div><span>{packs.length} 个</span></div>
        {packs.length === 0 ? (
          <div className="subtle-empty">还没有题库。可以先安装不含真实文档内容的合成示例。</div>
        ) : (
          <div className="installed-list">
            {packs.map((pack) => (
              <article key={pack.id} className={pack.id === activePackId ? "selected" : ""}>
                <div className="pack-monogram">{pack.chapters.length}</div>
                <div className="pack-description">
                  <div><h3>{pack.info.title}</h3><span className="version">v{pack.info.version}</span></div>
                  <p>{pack.info.questionCount} 题 · {pack.chapters.length} 章 · {pack.info.source.documentVersion}</p>
                  <small>{pack.info.license.notice ?? "仅限个人使用，禁止再分发。"}</small>
                </div>
                <div className="pack-actions">
                  {pack.id !== activePackId && <button onClick={() => setActivePackId(pack.id)}>设为当前</button>}
                  <button
                    className="danger-link"
                    onClick={async () => {
                      if (!confirm(`删除题库「${pack.info.title}」？学习进度将保留。`)) return;
                      await removePack(pack.id, false);
                      if (activePackId === pack.id) setActivePackId(null);
                    }}
                  >删除</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
