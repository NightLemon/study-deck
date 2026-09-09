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
  const loadedPacks = useLiveQuery(() => db.packs.orderBy("installedAt").toArray(), []);
  const packs = loadedPacks ?? [];
  const [activePackId, setActivePackIdState] = useState<string | null>(() => localStorage.getItem("qd-active-pack"));

  useEffect(() => {
    if (!loadedPacks) return;
    // Reconcile only when the database list changes. A just-imported selection
    // can arrive before liveQuery includes its pack; an older list must not undo it.
    setActivePackIdState(current => {
      const next = current && loadedPacks.some(pack => pack.id === current)
        ? current : loadedPacks[0]?.id ?? null;
      if (next) localStorage.setItem("qd-active-pack", next);
      else localStorage.removeItem("qd-active-pack");
      return next;
    });
  }, [loadedPacks]);

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
            <span className="brand-mark" aria-hidden="true">S</span>
            <span>
              <strong>Study Deck</strong>
              <small>可导入题库的自学平台</small>
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
      </div>
    </AppContext.Provider>
  );
};

export const App = () => (
  <HashRouter>
    <Shell />
  </HashRouter>
);
