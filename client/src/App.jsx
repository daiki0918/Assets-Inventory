import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthContext } from './context/AuthContext';
import Layout from './components/Layout';
import { api, clearAuth } from './lib/api';
import Assets from './pages/Assets';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Profile from './pages/Profile';
import Audit from './pages/Audit';
import Transfers from './pages/Transfers';
import Maintenance from './pages/Maintenance';
import Reports from './pages/Reports';
import Branches from './pages/Branches';
import Users from './pages/Users';
import Inventory from './pages/Inventory';
import Alerts from './pages/Alerts';
import useRealtimeRefresh from './lib/useRealtimeRefresh';

export default function App() {
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || 'null'); } catch { return null; } });
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('asset-theme') || 'dark');
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('asset-theme', theme); }, [theme]);
  useEffect(() => {
    const syncModalState = () => document.body.classList.toggle('modal-open', Boolean(document.querySelector('.modal-backdrop')));
    const observer = new MutationObserver(syncModalState);
    observer.observe(document.body, { childList: true, subtree: true });
    syncModalState();
    return () => { observer.disconnect(); document.body.classList.remove('modal-open'); };
  }, []);
  const reloadMeta = () => api('/meta').then((data) => {
    setMeta(data);
    setMetaError('');
    return data;
  }).catch((error) => {
    if (error.status === 401) {
      clearAuth();
      setMeta(null);
      setUser(null);
    } else {
      setMetaError(error.message);
    }
    throw error;
  });
  useEffect(() => { if (user) reloadMeta().catch(() => {}); }, [user]);
  useRealtimeRefresh(() => {
    if (user) return reloadMeta();
    return undefined;
  }, Boolean(user));
  if (!user) return <Login onDone={setUser} />;
  if (!meta) return <main className="app-main loading-page">{metaError ? <div role="alert"><p className="form-error">{metaError}</p><button className="btn" onClick={() => reloadMeta().catch(() => {})}>Retry</button></div> : <p className="sub">Loading your workspace…</p>}</main>;
  return <AuthContext.Provider value={{ user, meta, reloadMeta }}>
    <Layout theme={theme} setTheme={setTheme} onSignOut={() => { clearAuth(); setMeta(null); setMetaError(''); setUser(null); }}>
      {metaError && <p className="form-error" role="alert">Workspace data could not be refreshed: {metaError} <button className="btn btn-sm" onClick={() => reloadMeta().catch(() => {})}>Retry</button></p>}
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/assets" element={<Assets />} />
        <Route path="/assets/register" element={<Navigate to="/assets" replace />} />
        <Route path="/assets/import" element={<Navigate to="/assets?import=1" replace />} />
        <Route path="/assets/labels" element={<Navigate to="/assets" replace />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/transfers" element={<Transfers />} />
        <Route path="/maintenance" element={<Maintenance />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/audit" element={user.role === 'superadmin' ? <Audit /> : <Navigate to="/dashboard" replace />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/admin/branches" element={<Branches />} />
        <Route path="/admin/users" element={<Users />} />
        <Route path="/admin/*" element={<Navigate to="/admin/branches" replace />} />
        <Route path="/a/:token" element={<Profile />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  </AuthContext.Provider>;
}
