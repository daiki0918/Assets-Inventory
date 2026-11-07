import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Empty from '../components/Empty';
import PageHeader from '../components/PageHeader';
import Stat from '../components/Stat';
import { api } from '../lib/api';
import useRealtimeRefresh from '../lib/useRealtimeRefresh';

const filters = [
  { value: 'active', label: 'Active' },
  { value: 'unread', label: 'Unread' },
  { value: 'dismissed', label: 'Dismissed' },
];

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [filter, setFilter] = useState('active');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setAlerts(await api('/alerts?includeDismissed=true'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(load);

  const visibleAlerts = useMemo(() => alerts.filter((alert) => {
    if (filter === 'dismissed') return Boolean(alert.dismissedAt);
    if (alert.dismissedAt) return false;
    return filter !== 'unread' || !alert.readAt;
  }), [alerts, filter]);

  const act = async (alert, action) => {
    setBusyId(alert.id);
    setError('');
    try {
      const state = await api(`/alerts/${encodeURIComponent(alert.id)}/${action}`, { method: 'POST' });
      setAlerts((current) => current.map((item) => item.id === state.id ? { ...item, ...state } : item));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId('');
    }
  };

  const unreadCount = alerts.filter((alert) => !alert.readAt && !alert.dismissedAt).length;
  const activeCount = alerts.filter((alert) => !alert.dismissedAt).length;
  const action = <button className="btn" type="button" onClick={load} disabled={loading}>Refresh</button>;

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Alerts"
        description="Review asset issues and overdue maintenance. Read and dismissed states are saved to your account."
        action={action}
      />
      <section className="stats stats-four alert-summary">
        <Stat value={activeCount} label="Active" />
        <Stat value={unreadCount} label="Unread" />
        <Stat value={alerts.filter((alert) => alert.dismissedAt).length} label="Dismissed" />
      </section>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="chips alert-filters" role="group" aria-label="Filter alerts">
        {filters.map((item) => (
          <button
            className={`chip ${filter === item.value ? 'on' : ''}`}
            key={item.value}
            type="button"
            aria-pressed={filter === item.value}
            onClick={() => setFilter(item.value)}
          >
            {item.label}{item.value === 'active' ? ` (${activeCount})` : item.value === 'unread' ? ` (${unreadCount})` : ''}
          </button>
        ))}
      </div>
      <div className="alert-list">
        {loading ? <div className="card"><p className="sub">Loading alerts…</p></div> : !visibleAlerts.length ? (
          <div className="card">
            <Empty
              title={filter === 'dismissed' ? 'No dismissed alerts' : filter === 'unread' ? 'All caught up' : 'All clear'}
              text={filter === 'dismissed' ? 'Dismissed alerts will appear here.' : 'There are no alerts in this view.'}
            />
          </div>
        ) : visibleAlerts.map((alert) => {
          const dismissed = Boolean(alert.dismissedAt);
          const busy = busyId === alert.id;
          return (
            <article className={`card alert-card ${alert.readAt ? '' : 'is-unread'}`} key={alert.id}>
              <span className={`attention-icon ${alert.level}`} aria-hidden="true">!</span>
              <div className="alert-content">
                <div className="alert-title-row">
                  <h2>{alert.title}</h2>
                  {!alert.readAt && !dismissed && <span className="alert-unread-label">Unread</span>}
                </div>
                <p>{alert.detail}</p>
                <small>{[alert.branch, alert.location].filter(Boolean).join(' · ') || 'Asset record'}</small>
              </div>
              <div className="alert-actions">
                <Link className="btn btn-sm" to={`/a/${alert.token}`}>View asset</Link>
                {dismissed ? (
                  <button className="btn btn-sm" type="button" disabled={busy} onClick={() => act(alert, 'restore')}>
                    {busy ? 'Saving…' : 'Restore'}
                  </button>
                ) : (
                  <>
                    {!alert.readAt && (
                      <button className="btn btn-sm" type="button" disabled={busy} onClick={() => act(alert, 'read')}>
                        Mark read
                      </button>
                    )}
                    <button className="btn btn-sm btn-danger-ghost" type="button" disabled={busy} onClick={() => act(alert, 'dismiss')}>
                      {busy ? 'Saving…' : 'Dismiss'}
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
