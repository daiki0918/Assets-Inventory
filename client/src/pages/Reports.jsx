import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, peso } from '../lib/api';
import Empty from '../components/Empty';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import Status from '../components/Status';
import useRealtimeRefresh from '../lib/useRealtimeRefresh';

export default function Reports() {
  const [assets, setAssets] = useState([]);
  const [report, setReport] = useState('inventory');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 12;
  const load = () => {
    setError('');
    api('/assets').then(setAssets).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  const filtered = useMemo(() => assets.filter((asset) => `${asset.inventoryTag} ${asset.name} ${asset.description} ${asset.branch?.name} ${asset.location?.name}`.toLowerCase().includes(query.toLowerCase())), [assets, query]);
  const rows = report === 'disposals' ? filtered.filter((asset) => asset.status === 'Disposed') : filtered;
  const visible = rows.slice((page - 1) * pageSize, page * pageSize);
  const totals = assets.reduce((result, asset) => { result.count += 1; result.value += asset.cost || 0; result.book += asset.bookValue || 0; return result; }, { count: 0, value: 0, book: 0 });
  const changeReport = (event) => { setReport(event.target.value); setPage(1); };
  useEffect(() => { load(); }, []);
  useRealtimeRefresh(load);
  return <><PageHeader eyebrow="Reports" title="Reports" description="Review branch inventory, asset values, and disposal records." action={<button className="btn" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="report-stats">
      <div className="card report-stat-assets"><span>Total assets</span><b>{totals.count}</b><small>Based on assets visible to your account</small></div>
      <div className="card report-stat-cost"><span>Total cost</span><b>{peso(totals.value)}</b><small>Recorded purchase cost</small></div>
      <div className="card report-stat-book"><span>Book value</span><b>{peso(totals.book)}</b><small>Current asset value</small></div>
    </div>
    <div className="card report-toolbar">
      <input aria-label="Search report" placeholder="Search tags, names, branches, or locations" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
      <select aria-label="Report type" value={report} onChange={changeReport}><option value="inventory">Branch inventory</option><option value="disposals">Disposal report</option></select>
      <span className="report-result-count">{rows.length} {rows.length === 1 ? 'record' : 'records'}</span>
    </div>
    <div className="card report-table report-inventory-table">{loading ? <p className="sub report-loading">Loading report…</p> : !rows.length ? <Empty title="No report data" text="There are no records matching this report." /> : <><div className="report-head"><span>Asset</span><span>Branch / location</span><span>Status</span><span>Cost</span><span>Book value</span></div>{visible.map((asset) => <div className="report-row" key={asset._id}><span className="report-asset" data-label="Asset"><Link to={`/a/${asset.qrToken}`}>{asset.inventoryTag}</Link><small>{asset.name || 'Unnamed asset'}</small>{asset.description && <small>{asset.description}</small>}</span><span data-label="Branch / location"><strong>{asset.branch?.name || 'Unassigned'}</strong><small>{asset.location?.name || 'No location'}</small></span><span className="report-status" data-label="Status"><Status value={asset.status} /><small>Condition: {asset.condition || 'Good'}</small><small>{asset.purchaseDate ? new Date(asset.purchaseDate).toLocaleDateString('en-PH') : 'No purchase date'}</small></span><span className={!asset.cost ? 'report-cost-missing' : ''} data-label="Cost">{asset.cost ? peso(asset.cost) : 'Missing'}</span><span className="report-book-value" data-label="Book value">{peso(asset.bookValue)}</span></div>)}<Pagination page={page} pageSize={pageSize} total={rows.length} onChange={setPage} /></>}</div>
  </>;
}
