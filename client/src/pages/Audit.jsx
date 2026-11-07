import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import Empty from '../components/Empty';
import { api } from '../lib/api';
import Pagination from '../components/Pagination';
import useRealtimeRefresh from '../lib/useRealtimeRefresh';
import { downloadWorkbook } from '../lib/xlsxDownload';

export default function Audit() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ q: '', action: '', from: '', to: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 15;
  const visibleRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const load = (filters = form, { resetPage = true, showLoading = true } = {}) => {
    if (showLoading) setLoading(true);
    setError('');
    if (resetPage) setPage(1);
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    api(`/audit?${query}`).then(setRows).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  useRealtimeRefresh(() => load(form, { resetPage: false, showLoading: false }));
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const submit = (event) => { event.preventDefault(); load(); };
  const clearView = () => {
    const emptyFilters = { q: '', action: '', from: '', to: '' };
    setForm(emptyFilters);
    load(emptyFilters);
  };
  const clearHistory = async () => {
    setClearBusy(true); setError('');
    try { await api('/audit', { method: 'DELETE' }); setRows([]); setConfirmClear(false); } catch (e) { setError(e.message); } finally { setClearBusy(false); }
  };
  const exportExcel = async () => {
    setError('');
    try {
    const { default: XLSX } = await import('xlsx-js-style');
    const data = [
      ['COSMOPOLITAN FUNERAL HOMES-INC.'],
      ['Asset Register · Audit Log'],
      [`Generated: ${new Date().toLocaleString('en-PH')}`],
      [],
      ['Date and time', 'Asset code', 'Asset name', 'Branch', 'Location', 'Action', 'Changed by', 'Details'],
      ...rows.map((row) => [new Date(row.at).toLocaleString('en-PH'), row.inventoryTag, row.assetName, row.branch, row.location, row.action, row.by, row.note || '']),
    ];
    const sheet = XLSX.utils.aoa_to_sheet(data);
    sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } }, { s: { r: 2, c: 0 }, e: { r: 2, c: 7 } }];
    sheet['!cols'] = [{ wch: 22 }, { wch: 15 }, { wch: 25 }, { wch: 18 }, { wch: 18 }, { wch: 25 }, { wch: 20 }, { wch: 55 }];
    sheet['!autofilter'] = { ref: `A5:H${Math.max(5, data.length)}` };
    sheet['!freeze'] = { xSplit: 0, ySplit: 5 };
    ['A1', 'A2', 'A3'].forEach((cell) => { if (sheet[cell]) sheet[cell].s = { font: { bold: true, color: { rgb: '2F4FE8' }, sz: cell === 'A1' ? 16 : 11 }, alignment: { horizontal: 'left' } }; });
    for (let column = 0; column < 8; column += 1) {
      const cell = XLSX.utils.encode_cell({ r: 4, c: column });
      sheet[cell].s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '2F4FE8' } }, alignment: { horizontal: 'center', vertical: 'center' } };
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Audit Log');
    downloadWorkbook(XLSX, workbook, `cosmopolitan-audit-log-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      setError(e.message || 'Could not export the audit log.');
    }
  };
  return <><PageHeader eyebrow="Operations" title="Audit log" description="Every asset change, transfer, maintenance entry, and document action in one record." action={<><button className="btn compact-action" onClick={exportExcel} disabled={!rows.length}>Download Excel</button><button className="btn danger" onClick={() => setConfirmClear(true)}>Clear history</button><button className="btn" onClick={() => load()}>Refresh</button></>} />
    <form className="audit-inline-filters" onSubmit={submit}><div><label htmlFor="audit-search">Search</label><input id="audit-search" value={form.q} onChange={update('q')} placeholder="Tag, asset, note, or user" /></div><div><label htmlFor="audit-action">Action</label><input id="audit-action" value={form.action} onChange={update('action')} placeholder="Transfer, updated..." /></div><div><label htmlFor="audit-from">From</label><input id="audit-from" type="date" value={form.from} onChange={update('from')} /></div><div><label htmlFor="audit-to">To</label><input id="audit-to" type="date" value={form.to} onChange={update('to')} /></div><div className="audit-filter-actions"><button className="btn blue">Apply</button><button className="btn" type="button" onClick={clearView}>Clear</button></div></form>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="card audit-table-card">{loading ? <p className="sub">Loading audit history…</p> : !rows.length ? <Empty title="No audit entries" text="Changes will appear here as assets are updated." /> : <div className="audit-table"><div className="audit-head"><span>Date</span><span>Asset</span><span>Action</span><span>Changed by</span><span>Details</span></div>{visibleRows.map((row) => {
      const date = new Date(row.at);
      const actor = row.by || 'System';
      const initials = actor.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
      return <div className="audit-row" key={row.id}>
        <span className="audit-date" data-label="Date"><strong>{date.toLocaleDateString('en-PH')}</strong><small>{date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</small></span>
        <span className="audit-asset" data-label="Asset"><Link to={`/a/${row.qrToken}`}>{row.inventoryTag}</Link><small>{[row.assetName, row.branch, row.location].filter(Boolean).join(' · ')}</small></span>
        <span className="audit-action-cell" data-label="Action"><span className="audit-action">{row.action}</span></span>
        <span className="audit-actor" data-label="Changed by"><span className="audit-avatar" aria-hidden="true">{initials || 'S'}</span><span>{actor}</span></span>
        <span className="audit-details" data-label="Details">{row.note || '—'}</span>
      </div>;
    })}</div>}</div>
    <Pagination page={page} pageSize={pageSize} total={rows.length} onChange={setPage} />
    {confirmClear && <div className="modal-backdrop"><div className="modal-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="clear-audit-title"><div className="modal-heading"><p className="eyebrow">Permanent deletion</p><h2 id="clear-audit-title">Clear all audit history?</h2><p className="sub">This permanently removes every stored history entry across all branches. Asset records, locations, QR codes, and maintenance data will remain.</p></div><div className="modal-actions"><button className="btn" type="button" onClick={() => setConfirmClear(false)} disabled={clearBusy}>Cancel</button><button className="btn danger" type="button" onClick={clearHistory} disabled={clearBusy}>{clearBusy ? 'Clearing…' : 'Clear permanently'}</button></div></div></div>}
  </>;
}
