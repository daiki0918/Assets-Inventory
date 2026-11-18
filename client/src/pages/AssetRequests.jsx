import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import Empty from '../components/Empty';
import PageHeader from '../components/PageHeader';
import AssetRequestForm from '../components/AssetRequestForm';
import useRealtimeRefresh from '../lib/useRealtimeRefresh';

export default function AssetRequests() {
  const { user, meta } = useAuth();
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const load = () => api('/asset-requests').then((rows) => { setRequests(rows); setError(''); }).catch((e) => setError(e.message));
  const visibleRequests = [...requests].filter((request) => (
    (!branchFilter || String(request.branch?._id) === branchFilter)
    && (!statusFilter || request.status === statusFilter)
    && (!search.trim() || [request.name, request.category, request.note, request.branch?.name, request.requestedBy?.name]
      .some((value) => String(value || '').toLowerCase().includes(search.trim().toLowerCase())))
  )).sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || new Date(b.createdAt) - new Date(a.createdAt));
  useEffect(() => { load(); }, []);
  useRealtimeRefresh(load);

  const review = async (request, status) => {
    setBusy(request._id);
    setError('');
    try {
      await api(`/asset-requests/${request._id}/review`, { method: 'POST', body: { status } });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  return <div className="asset-requests-page"><PageHeader eyebrow={user.role === 'superadmin' ? 'Admin · All branches' : 'Your branch'} title="Asset requests" description={user.role === 'superadmin' ? 'Review new asset requests from branch operators.' : 'Request assets for your branch and track their review status.'} />
    {error && <p className="form-error" role="alert">{error}</p>}
    {user.role === 'operator' ? <section className="card asset-requests-card operator-requests-card">
      <div className="section-heading"><div><h2>Your requests</h2><p className="sub">Track asset requests submitted for your branch.</p></div><button className="btn blue" type="button" onClick={() => setRequestFormOpen(true)}>+ Add request</button></div>
      {requests.length ? <div className="asset-requests-table-wrap"><table className="asset-requests-table operator-asset-requests-table"><thead><tr><th>Requested asset</th><th>Qty</th><th>Submitted</th><th>Status</th></tr></thead><tbody>{[...requests].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((request) => <tr key={request._id}><td><span className="asset-requests-item"><b>{request.name}</b><small>{request.category || 'Uncategorized'}</small>{request.note && <small className="asset-requests-note" title={request.note}>{request.note}</small>}</span></td><td className="asset-requests-quantity">{request.quantity}</td><td>{new Date(request.createdAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}</td><td><span className={`asset-request-status ${request.status}`}>{request.status}</span>{request.reviewedBy?.name && <small className="asset-requests-reviewer">by {request.reviewedBy.name}</small>}</td></tr>)}</tbody></table></div> : <Empty title="No asset requests yet" text="Use Add request to ask the asset admin for something your branch needs." />}
    </section> : <section className="card asset-requests-card">
      <div className="section-heading"><div><h2>Incoming requests</h2><p className="sub">Pending requests appear first.</p></div><span className="filter-count">{visibleRequests.filter((request) => request.status === 'pending').length} pending</span></div>
      <div className="asset-requests-filters"><label className="search-field"><span aria-hidden="true">⌕</span><input aria-label="Search asset requests" placeholder="Search asset, requester, branch, or note" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="asset-request-filter"><span>Branch</span><select aria-label="Filter requests by branch" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}><option value="">All branches</option>{meta.branches.map((branch) => <option key={branch._id} value={branch._id}>{branch.name}</option>)}</select></label><label className="asset-request-filter"><span>Status</span><select aria-label="Filter requests by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label>{(search || branchFilter || statusFilter) && <button className="btn" type="button" onClick={() => { setSearch(''); setBranchFilter(''); setStatusFilter(''); }}>Clear filters</button>}</div>
      {visibleRequests.length ? <div className="asset-requests-table-wrap"><table className="asset-requests-table"><thead><tr><th>Requested asset</th><th>Branch</th><th>Requested by</th><th>Qty</th><th>Submitted</th><th>Status</th><th>Action</th></tr></thead><tbody>{visibleRequests.map((request) => <tr key={request._id}>
        <td><span className="asset-requests-item"><b>{request.name}</b><small>{request.category || 'Uncategorized'}</small>{request.note && <small className="asset-requests-note" title={request.note}>{request.note}</small>}</span></td>
        <td>{request.branch?.name || 'Branch'}</td><td>{request.requestedBy?.name || 'Operator'}</td><td className="asset-requests-quantity">{request.quantity}</td>
        <td>{new Date(request.createdAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
        <td><span className={`asset-request-status ${request.status}`}>{request.status}</span>{request.reviewedBy?.name && <small className="asset-requests-reviewer">by {request.reviewedBy.name}</small>}</td>
        <td>{request.status === 'pending' ? <div className="asset-request-actions"><button type="button" className="btn btn-sm blue asset-request-approve" aria-label={`Approve ${request.name}`} disabled={busy === request._id} onClick={() => review(request, 'approved')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>{busy === request._id ? 'Saving...' : 'Approve'}</button><button type="button" className="btn btn-sm danger asset-request-reject" aria-label={`Reject ${request.name}`} disabled={busy === request._id} onClick={() => review(request, 'rejected')}>{busy === request._id ? 'Saving...' : 'Reject'}</button></div> : <span className="asset-requests-complete">Reviewed</span>}</td>
      </tr>)}</tbody></table></div> : <Empty title={requests.length ? 'No matching requests' : 'No asset requests'} text={requests.length ? 'Change or clear your filters to see more requests.' : 'New requests from branch operators will appear here.'} />}
    </section>}
    {requestFormOpen && <AssetRequestForm onClose={() => setRequestFormOpen(false)} onCreated={load} />}
  </div>;
}
