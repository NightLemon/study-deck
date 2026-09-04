import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { HashRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { db } from "./lib/db";
import { DashboardPage } from "./pages/DashboardPage";
import { PackManagerPage } from "./pages/PackManagerPage";
import { StudyPage } from "./pages/StudyPage";

interface AppContextValue {
  activePackId: string | null;
  setActivePackId: (packId: string | null) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export const useApp = () => {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp 必须在 AppContext 内使用");
  return value;
};

const Shell = () => {
  const location = useLocation();
  const packs = useLiveQuery(() => db.packs.orderBy("installedAt").toArray(), []) ?? [];
  const [activePackId, setActivePackIdState] = useState<string | null>(() => localStorage.getItem("qd-active-pack"));

  useEffect(() => {
    if (packs.length === 0) {
      setActivePackIdState(null);
      localStorage.removeItem("qd-active-pack");
      return;
    }
    if (!activePackId || !packs.some((pack) => pack.id === activePackId)) {
      setActivePackIdState(packs[0].id);
      localStorage.setItem("qd-active-pack", packs[0].id);
    }
  }, [activePackId, packs]);

  const setActivePackId = (packId: string | null) => {
    setActivePackIdState(packId);
    if (packId) localStorage.setItem("qd-active-pack", packId);
    else localStorage.removeItem("qd-active-pack");
  };

  const context = useMemo(() => ({ activePackId, setActivePackId }), [activePackId]);

  return (
    <AppContext.Provider value={context}>
      <div className="app-shell">
        <header className="topbar">
          <Link to="/" className="brand" aria-label="返回总览">
            <span className="brand-mark" aria-hidden="true">Q</span>
            <span>
              <strong>Quant Dev</strong>
              <small>离线自学平台</small>
            </span>
          </Link>
          <nav className="main-nav" aria-label="主导航">
            <Link className={location.pathname === "/" ? "active" : ""} to="/">总览</Link>
            <Link className={location.pathname.startsWith("/study") ? "active" : ""} to="/study">学习</Link>
            <Link className={location.pathname.startsWith("/packs") ? "active" : ""} to="/packs">题库</Link>
          </nav>
          <label className="pack-switcher">
            <span>当前题库</span>
            <select
              aria-label="切换当前题库"
              value={activePackId ?? ""}
              onChange={(event) => setActivePackId(event.target.value || null)}
            >
              {packs.length === 0 && <option value="">尚未导入</option>}
              {packs.map((pack) => (
                <option key={pack.id} value={pack.id}>{pack.info.title}</option>
              ))}
            </select>
          </label>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/study" element={<StudyPage />} />
            <Route path="/packs" element={<PackManagerPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <footer className="footer">
          <span>数据只保存在当前浏览器</span>
          <span className="offline-dot"><i /> 支持离线使用</span>
        </footer>
      </div>
    </AppContext.Provider>
  );
};

export const App = () => (
  <HashRouter>
    <Shell />
  </HashRouter>
);
