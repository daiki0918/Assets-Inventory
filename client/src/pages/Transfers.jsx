import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import Empty from '../components/Empty';
import PageHeader from '../components/PageHeader';
import Status from '../components/Status';
import Pagination from '../components/Pagination';
import useRealtimeRefresh from '../lib/useRealtimeRefresh';

export default function Transfers() {
  const { meta, user } = useAuth();
  const [assets, setAssets] = useState([]);
  const [transferOptions, setTransferOptions] = useState({ branches: meta.branches, locations: meta.locations });
  const [requests, setRequests] = useState([]);
  const [selectedAssets, setSelectedAssets] = useState([]);
  const [destination, setDestination] = useState({ branch: '', location: '' });
  const [reason, setReason] = useState('');
  const [query, setQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [requestPage, setRequestPage] = useState(1);
  const pageSize = 10;
  const requestPageSize = 10;
  const load = () => api('/assets').then(setAssets).catch((e) => setError(e.message));
  const loadOptions = () => api('/transfer/options').then(setTransferOptions).catch((e) => setError(e.message));
  const loadRequests = () => api('/transfer-requests').then(setRequests).catch((e) => setError(e.message));
  const refreshTransfers = () => Promise.all([load(), loadOptions(), loadRequests()]);
  useEffect(() => { refreshTransfers(); }, []);
  useRealtimeRefresh(refreshTransfers);
  const locations = useMemo(() => transferOptions.locations.filter((item) => String(item.branch?._id || item.branch) === destination.branch), [transferOptions.locations, destination.branch]);
  const selectedInTransit = selectedAssets.length === 1 && selectedAssets[0].status === 'In-Transit';
  const destinationBranches = transferOptions.branches.filter((branch) => selectedAssets.every((asset) => String(branch._id) !== String(asset.branch?._id || asset.branch)));
  const pendingAssetIds = new Set(requests.filter((request) => ['pending', 'approving'].includes(request.status)).map((request) => String(request.asset?._id || request.asset)));
  const rows = assets.filter((asset) => asset.status !== 'Disposed' && !pendingAssetIds.has(String(asset._id)) && `${asset.inventoryTag} ${asset.name} ${asset.branch?.name} ${asset.location?.name}`.toLowerCase().includes(query.toLowerCase()) && (!status || asset.status === status));
  const visibleRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const toggleAsset = (asset) => setSelectedAssets((current) => {
    const alreadySelected = current.some((item) => item._id === asset._id);
    if (alreadySelected) return current.filter((item) => item._id !== asset._id);
    if (asset.status === 'In-Transit' || current.some((item) => item.status === 'In-Transit')) return [asset];
    return [...current, asset];
  });
  const submit = async (event) => {
    event.preventDefault();
    if (!selectedAssets.length || !destination.branch || !destination.location) return setError('Select at least one asset, destination branch, and destination location.');
    if (!reason.trim()) return setError('Enter a reason for this transfer.');
    setBusy(true); setError('');
    try {
      await api('/transfer-requests', { method: 'POST', body: { assets: selectedAssets.map((asset) => asset._id), ...destination, note: reason.trim() } });
      setSelectedAssets([]);
      setDestination({ branch: '', location: '' });
      setReason('');
      await refreshTransfers();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const receive = async () => {
    if (!selectedInTransit) return;
    setBusy(true); setError('');
    try { const saved = await api(`/assets/${selectedAssets[0]._id}/receive`, { method: 'POST' }); setSelectedAssets([saved]); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { setPage(1); }, [query, status]);
  const sortedRequests = [...requests].sort((left, right) => {
    return new Date(right.createdAt) - new Date(left.createdAt);
  });
  const visibleRequests = sortedRequests.slice((requestPage - 1) * requestPageSize, requestPage * requestPageSize);
  return <><PageHeader eyebrow="Operations" title="Transfers" description="Move assets between branches and confirm receipt at the destination." action={<button className="btn" onClick={refreshTransfers}>Refresh</button>} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="card transfer-requests">
      <div className="section-heading">
        <div><h2>{user.role === 'superadmin' ? 'Transfer history' : 'My transfer history'}</h2><p className="sub">Branch transfers are approved automatically and remain in transit until received.</p></div>
      </div>
      {requests.length ? <>
        <div className="transfer-requests-table-wrap">
          <table className="transfer-requests-table">
            <thead><tr><th>Asset</th><th>Transfer route</th><th>Reason</th><th>{user.role === 'superadmin' ? 'Requested by' : 'Requested'}</th><th>Status</th></tr></thead>
            <tbody>{visibleRequests.map((request) => (
              <tr key={request._id}>
                <td><span className="transfer-table-asset"><b>{request.asset?.inventoryTag || 'Asset unavailable'}</b><small>{request.asset?.name || 'Asset record'}{request.sourceLocation?.name && <><span aria-hidden="true"> · </span>{request.sourceLocation.name}</>}</small></span></td>
                <td><span className="transfer-table-route"><b>{request.sourceBranch?.name || 'Source branch'}<small>{request.sourceLocation?.name || (request.status === 'pending' ? request.asset?.location?.name : '') || 'Location unavailable'}</small></b><span aria-hidden="true">→</span><b>{request.destinationBranch?.name || 'Destination branch'}<small>{request.destinationLocation?.name || 'Location'}</small></b></span></td>
                <td><span className="transfer-table-reason" title={request.note || 'No reason provided'}>{request.note || 'No reason provided'}</span></td>
                <td><span className="transfer-table-requester">{user.role === 'superadmin' ? request.requestedBy?.name || 'Staff' : new Date(request.createdAt).toLocaleString('en-PH')}</span></td>
                <td><span className={`transfer-request-status ${request.status}`}>{request.status === 'approved' ? request.asset?.status === 'In-Transit' ? 'In transit' : 'Received' : request.status === 'approving' ? 'Processing' : request.status}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <Pagination page={requestPage} pageSize={requestPageSize} total={sortedRequests.length} onChange={setRequestPage} />
      </> : <p className="transfer-requests-empty">No transfers recorded yet.</p>}
    </section>
    <div className="operation-layout"><div className="card transfer-assets-card"><form className="asset-toolbar operation-search" onSubmit={(event) => { event.preventDefault(); setQuery(searchInput.trim()); }}><div className="search-field"><span aria-hidden="true">⌕</span><input aria-label="Search transfer assets" placeholder="Search assets" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} /></div><button className="btn blue" type="submit">Search</button><select aria-label="Filter transfer status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option>Active</option><option>Damaged</option><option>In-Transit</option></select></form><div className="transfer-list-heading"><div><h2>Available assets</h2><p>Select multiple assets for one destination transfer.</p></div><span className="filter-count">{rows.length}</span></div><div className="operation-list transfer-list">{visibleRows.map((asset) => { const isSelected = selectedAssets.some((item) => item._id === asset._id); return <button className={`operation-row ${isSelected ? 'selected' : ''}`} key={asset._id} aria-pressed={isSelected} onClick={() => toggleAsset(asset)}><span className="transfer-asset-info" data-label="Asset"><b className="transfer-tag">{asset.inventoryTag}</b><small>{asset.name || 'Unnamed asset'}</small></span><span className="transfer-location" data-label="Branch / location"><strong>{asset.branch?.name || 'Unassigned'}</strong><small>{asset.location?.name || 'No location'}</small></span><span className="transfer-status" data-label="Status"><Status value={asset.status} /></span></button>; })}{!rows.length && <Empty title="No assets found" text="Try another search or status." />}</div><Pagination page={page} pageSize={pageSize} total={rows.length} onChange={setPage} /></div>
      <form className="card operation-form" onSubmit={submit}><p className="eyebrow">{selectedInTransit ? 'Receive asset' : 'Transfer assets'}</p><h2>{selectedInTransit ? selectedAssets[0].inventoryTag : selectedAssets.length ? `${selectedAssets.length} assets selected` : 'Select assets'}</h2><p className="sub">{selectedInTransit ? `Destination: ${selectedAssets[0].branch?.name} · ${selectedAssets[0].location?.name}` : selectedAssets.length ? `${[...new Set(selectedAssets.map((asset) => asset.branch?.name || 'Branch'))].join(', ')} → select destination` : 'Choose one or more assets from the list to begin.'}</p>{selectedInTransit ? <><div className="notice-box"><b>Awaiting receipt</b><span>Verify that this asset arrived at the destination location.</span></div><button className="btn blue block" type="button" disabled={busy} onClick={receive}>{busy ? 'Updating…' : 'Receive and set Active'}</button></> : <><label htmlFor="transfer-destination-branch">Destination branch</label><select id="transfer-destination-branch" value={destination.branch} disabled={!selectedAssets.length} onChange={(e) => setDestination({ branch: e.target.value, location: '' })}><option value="">Select branch</option>{destinationBranches.map((branch) => <option key={branch._id} value={branch._id}>{branch.name}</option>)}</select><label htmlFor="transfer-destination-location">Destination location</label><select id="transfer-destination-location" value={destination.location} disabled={!destination.branch} onChange={(e) => setDestination({ ...destination, location: e.target.value })}><option value="">Select location</option>{locations.map((location) => <option key={location._id} value={location._id}>{location.name}</option>)}</select><label htmlFor="transfer-reason">Reason for transfer</label><textarea id="transfer-reason" rows="3" maxLength="500" required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why these assets need to move" /><small className="transfer-reason-count">{reason.length}/500</small><button className="btn blue block" disabled={!selectedAssets.length || !destination.branch || !destination.location || !reason.trim() || busy}>{busy ? 'Transferring…' : `Transfer ${selectedAssets.length || ''} asset${selectedAssets.length === 1 ? '' : 's'}`}</button><p className="sub">Transfers are automatically approved. Assets remain in transit until received by the destination branch.</p></>}</form></div>
  </>;
}
