import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { HashRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { db } from "./lib/db";
import { DashboardPage } from "./pages/DashboardPage";
import { PackManagerPage } from "./pages/PackManagerPage";
import { StudyPage } from "./pages/StudyPage";
import { LearningPage } from "./pages/LearningPage";

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
  const navigate = useNavigate();
  const loadedPacks = useLiveQuery(() => db.packs.orderBy("installedAt").toArray(), []);
  const packs = loadedPacks ?? [];
  const [activePackId, setActivePackIdState] = useState<string | null>(() => localStorage.getItem("qd-active-pack"));

  useEffect(() => {
    if (!loadedPacks) return;
    let cancelled = false;
    const reconcile = async () => {
      if (activePackId) {
        if (loadedPacks.some((pack) => pack.id === activePackId)) return;
        // An import can finish before the live list refreshes. Check persisted
        // data before replacing an explicitly selected, newly installed pack.
        if (await db.packs.get(activePackId)) return;
      }
      if (cancelled) return;
      const nextId = loadedPacks[0]?.id ?? null;
      setActivePackIdState(nextId);
      if (nextId) localStorage.setItem("qd-active-pack", nextId);
      else localStorage.removeItem("qd-active-pack");
    };
    void reconcile();
    return () => { cancelled = true; };
  }, [activePackId, loadedPacks]);

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
            <Link className={location.pathname.startsWith("/learning") ? "active" : ""} to="/learning">学习记录</Link>
            <Link className={location.pathname.startsWith("/packs") ? "active" : ""} to="/packs">题库</Link>
          </nav>
          <label className="pack-switcher">
            <span>当前题库</span>
            <select
              aria-label="切换当前题库"
              value={activePackId ?? ""}
              onChange={(event) => {
                setActivePackId(event.target.value || null);
                if (location.pathname === "/study") navigate("/study");
              }}
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
            <Route path="/learning" element={<LearningPage />} />
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
