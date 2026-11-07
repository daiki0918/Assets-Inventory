import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, peso } from '../lib/api';
import Chart from '../components/Chart';
import Empty from '../components/Empty';
import PageHeader from '../components/PageHeader';
import Stat from '../components/Stat';
import Status from '../components/Status';
import useRealtimeRefresh from '../lib/useRealtimeRefresh';
import LineChart from '../components/LineChart';
import { getManilaMonth } from '../lib/date';

const getPurchaseTrend = (assets, now) => {
  const currentMonth = getManilaMonth(now);
  const [year, month] = currentMonth.split('-').map(Number);
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (11 - index), 1));
    const key = date.toISOString().slice(0, 7);
    return {
      key,
      count: 0,
      label: date.toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      shortLabel: date.toLocaleDateString('en-PH', { month: 'short', timeZone: 'UTC' }),
    };
  });
  const counts = new Map(months.map((item) => [item.key, item]));
  assets.forEach((asset) => {
    if (!asset.purchaseDate) return;
    const key = new Date(asset.purchaseDate).toISOString().slice(0, 7);
    const monthData = counts.get(key);
    if (monthData) monthData.count += 1;
  });
  return months;
};

export default function Dashboard() {
  const { user } = useAuth(); const [metrics, setMetrics] = useState(null); const [dashboard, setDashboard] = useState(null); const [alerts, setAlerts] = useState([]); const [assets, setAssets] = useState([]); const [error, setError] = useState('');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timerId = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timerId);
  }, []);
  const refreshDashboard = () => Promise.all([api('/metrics'), api('/dashboard'), api('/alerts'), api('/assets')])
    .then(([m, d, a, rows]) => { setMetrics(m); setDashboard(d); setAlerts(a); setAssets(rows); setError(''); })
    .catch((e) => setError(e.message));
  useEffect(() => { refreshDashboard(); }, []);
  useRealtimeRefresh(refreshDashboard);
  if ((!metrics || !dashboard) && error) return <div className="card"><h2>Dashboard unavailable</h2><p className="err">{error}</p><button className="btn" onClick={refreshDashboard}>Retry</button></div>;
  if (!metrics || !dashboard) return <p className="sub">Loading dashboard…</p>;
  const missing = assets.filter((a) => !a.cost || !a.serialNo || !a.qrImage).length;
  const purchaseTrend = getPurchaseTrend(assets, now);
  return <div className="dashboard-page"><PageHeader eyebrow={user.role === 'superadmin' ? 'All branches' : 'Your branch'} title="Dashboard" description="A clear view of your inventory at a glance." action={<><span className="dashboard-live"><i aria-hidden="true" />Live data</span><span className="dashboard-date" aria-label={`Current date and time in the Philippines: ${now.toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`}>
      <span className="dashboard-date-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></svg>
        <time dateTime={now.toISOString()}>{now.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })}</time>
      </span>
      <span className="dashboard-date-item dashboard-time">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        <time dateTime={now.toISOString()}>{now.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Manila' })} PHT</time>
      </span>
    </span><Link className="btn blue" to="/assets">View all assets</Link></>} />
    {error && <div className="inline-error" role="alert">{error}<button className="btn btn-sm" onClick={refreshDashboard}>Retry</button></div>}
    <section className="stats stats-four dashboard-stats">
      <Stat className="dashboard-stat-blue" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" /><path d="M14 3v6h6M8 14h8M8 17h5" /></svg>} value={metrics.inService} label="In service" detail="Ready for use" />
      <Stat className="dashboard-stat-green" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 7c0-1.7-2.2-3-5-3S7 5.3 7 7s2.2 3 5 3 5 1.3 5 3-2.2 4-5 4-5-1.3-5-3" /></svg>} value={metrics.bookValue ? peso(metrics.bookValue) : 'Value missing'} label="Book value" missing={!metrics.bookValue} detail="Current asset valuation" />
      <Stat className="dashboard-stat-amber" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>} value={metrics.maintenanceDue || 0} label="Maintenance due" detail="Scheduled service" />
      <Stat className="dashboard-stat-red" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 2.8 19a1.4 1.4 0 0 0 1.2 2h16a1.4 1.4 0 0 0 1.2-2L12 3Z" /><path d="M12 9v4M12 17h.01" /></svg>} value={alerts.length + missing} label="Needs attention" detail={`${alerts.length} alerts · ${missing} incomplete`} />
    </section>
    <section className="chart-grid"><Chart title="Asset status" items={dashboard.byStatus} type="donut" /><Chart title="Assets by cluster" items={dashboard.byCluster} /><Chart title="Asset value by branch" items={dashboard.valueByBranch || dashboard.byBranch} value /></section>
    <LineChart title="Asset purchase trend" items={purchaseTrend} />
    <section className="dashboard-strip"><div><span className="strip-label">Inventory health</span><strong>{missing ? 'Action needed' : 'Looking good'}</strong><p>{missing ? `${missing} records are missing important details.` : 'Your asset records are complete and ready for review.'}</p></div><div className="health-meter"><span style={{ width: `${Math.max(8, Math.min(100, assets.length ? ((assets.length - missing) / assets.length) * 100 : 8))}%` }} /></div><Link className="text-link" to="/assets">Review records →</Link></section>
    <section className="dashboard-lower"><div className="card"><div className="section-heading"><h2>Recent activity</h2><Link to="/assets">View assets</Link></div>{assets.slice(0, 5).map((a) => <Link className="activity" to={`/a/${a.qrToken}`} key={a._id}><span className="activity-dot" /><span><b>{a.inventoryTag}</b> {a.name}<small>{a.branch?.name || 'Branch'} · {new Date(a.updatedAt || a.createdAt).toLocaleDateString('en-PH')}</small></span><Status value={a.status} /></Link>)}{!assets.length && <Empty title="No activity yet" text="Register an asset to see changes here." />}</div>
      <div className="card"><div className="section-heading"><h2>Needs attention</h2><Link to="/alerts">See all</Link></div>{alerts.slice(0, 5).map((alert, index) => <Link className="attention" key={`${alert.token}-${index}`} to={`/a/${alert.token}`}><span className={`attention-icon ${alert.level}`}>!</span><span><b>{alert.title}</b><small>{alert.detail}</small></span></Link>)}{missing > 0 && <div className="attention"><span className="attention-icon warning">!</span><span><b>Incomplete data</b><small>{missing} asset records need details</small></span></div>}{!alerts.length && !missing && <Empty title="All clear" text="Nothing needs attention right now." />}</div></section>
  </div>;
}
