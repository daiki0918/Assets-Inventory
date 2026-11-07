import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, peso } from '../lib/api';
import { createAssetQr } from '../lib/assetQr';
import PageHeader from '../components/PageHeader';
import Stat from '../components/Stat';
import Status from '../components/Status';
import AssetModal from '../components/AssetModal';
import useRealtimeRefresh from '../lib/useRealtimeRefresh';

export default function Profile() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, meta } = useAuth();
  const [asset, setAsset] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [qrImage, setQrImage] = useState('');
  const [qrError, setQrError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [statusForm, setStatusForm] = useState({ condition: 'Good', status: '', locationId: '', disposalDate: '', note: '' });
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState('');
  const statusFormDirty = Boolean(asset && (
    statusForm.condition !== (asset.condition || 'Good')
    || statusForm.status !== asset.status
    || statusForm.locationId !== (asset.location?._id || '')
    || statusForm.disposalDate
    || statusForm.note
  ));

  const refreshAsset = () => api(`/assets/qr/${token}`)
    .then((current) => { setAsset(current); setError(''); })
    .catch((e) => { setError(e.message); throw e; });
  useEffect(() => { refreshAsset().catch(() => {}); }, [token]);
  useRealtimeRefresh(refreshAsset, !editing && !statusBusy && !statusFormDirty);
  useEffect(() => {
    if (!asset) return;
    setStatusForm({ condition: asset.condition || 'Good', status: asset.status, locationId: asset.location?._id || '', disposalDate: '', note: '' });
  }, [asset]);
  useEffect(() => {
    if (!asset) return;
    createAssetQr(asset.inventoryTag).then(setQrImage).catch((e) => setQrError(e.message));
  }, [asset?.inventoryTag]);

  if (error && !asset) return <div className="card"><h2>Can’t open this asset</h2><p className="err">{error}</p><button className="btn" onClick={() => navigate('/assets')}>Back to assets</button></div>;
  if (!asset) return <p className="sub">Loading asset…</p>;

  const locked = asset.status === 'Disposed';
  const downloadLabel = async () => {
    setDownloading(true);
    setDownloadError('');
    try {
      const { downloadQrLabels } = await import('../lib/qrLabels');
      await downloadQrLabels([asset]);
    } catch (e) { setDownloadError(e.message); } finally { setDownloading(false); }
  };
  const deleteAsset = async () => {
    setDeleteBusy(true);
    setDeleteError('');
    try { await api(`/assets/${asset._id}`, { method: 'DELETE' }); navigate('/assets'); } catch (e) { setDeleteError(e.message); setDeleteBusy(false); }
  };
  const updateStatus = async (event) => {
    event.preventDefault();
    setStatusBusy(true);
    setStatusError('');
    try {
      const updated = await api(`/assets/${asset._id}/audit`, {
        method: 'POST',
        body: statusForm,
      });
      setAsset(updated);
    } catch (e) {
      setStatusError(e.message);
    } finally {
      setStatusBusy(false);
    }
  };
  const assetLocations = meta.locations.filter((location) => location.branch === asset.branch?._id || location.branch?._id === asset.branch?._id);

  return <div className="asset-profile"><PageHeader eyebrow={`${asset.branch?.name || ''} · ${asset.cluster?.name || ''}`} title={asset.inventoryTag} description={asset.name} action={<><span className="profile-status"><Status value={asset.status} /></span>{user.role === 'superadmin' && !locked && <button className="btn" onClick={() => setEditing(true)}>Edit asset</button>}{user.role === 'superadmin' && !locked && <button className="btn danger" onClick={() => setConfirmDelete(true)}>Delete</button>}</>} />
    {error && <p className="form-error" role="alert">Asset data could not be refreshed: {error}<button className="btn btn-sm" onClick={() => refreshAsset().catch(() => {})}>Retry</button></p>}
    <div className="detail-grid"><div>
      <div className="card asset-hero"><div className="asset-photo">{asset.photoUrl ? <img src={asset.photoUrl} alt="" /> : <span>PHOTO</span>}</div><div><p className="eyebrow">Asset record</p><h2>{asset.name}</h2><p className="sub">{asset.category || 'Uncategorized'} · {asset.serialNo || 'Serial number missing'}</p><p className="sub">Condition: {asset.condition || 'Good'}</p>{asset.description && <p className="sub">{asset.description}</p>}<div className="detail-stats"><Stat value={asset.cost ? peso(asset.cost) : 'Value missing'} label="Cost" missing={!asset.cost} /><Stat value={asset.bookValue ? peso(asset.bookValue) : 'Value missing'} label="Book value" missing={!asset.bookValue} /></div></div></div>
      <div className="card"><h2>Location</h2><div className="location-summary"><span className="location-icon">⌂</span><span><b>{asset.location?.name}</b><small>{asset.branch?.name} · {asset.cluster?.name}</small></span></div></div>
      <form className="card asset-status-form" onSubmit={updateStatus}><p className="eyebrow">Individual asset tracking</p><h2>Condition, status & location</h2><label htmlFor="asset-condition">Condition</label><input id="asset-condition" maxLength="120" value={statusForm.condition} onChange={(event) => setStatusForm({ ...statusForm, condition: event.target.value })} placeholder="e.g. Good, worn upholstery" disabled={locked} /><label htmlFor="asset-status">Status</label><select id="asset-status" value={statusForm.status} onChange={(event) => setStatusForm({ ...statusForm, status: event.target.value })} disabled={locked}><option value="">Select status</option>{meta.statuses.map((item) => <option key={item} value={item}>{item}</option>)}</select><label htmlFor="asset-status-location">Location / room</label><select id="asset-status-location" value={statusForm.locationId} onChange={(event) => setStatusForm({ ...statusForm, locationId: event.target.value })} disabled={locked}><option value="">Select location</option>{assetLocations.map((location) => <option key={location._id} value={location._id}>{location.name}</option>)}</select>{statusForm.status === 'Disposed' && <><label htmlFor="asset-disposal-date">Disposal date</label><input id="asset-disposal-date" type="date" required value={statusForm.disposalDate} onChange={(event) => setStatusForm({ ...statusForm, disposalDate: event.target.value })} disabled={locked} /></>}<label htmlFor="asset-status-note">History note</label><textarea id="asset-status-note" rows="2" value={statusForm.note} onChange={(event) => setStatusForm({ ...statusForm, note: event.target.value })} placeholder="Optional update note" disabled={locked} />{statusError && <p className="form-error" role="alert">{statusError}</p>}<button className="btn blue" disabled={locked || statusBusy}>{statusBusy ? 'Updating…' : 'Save status & location'}</button></form>
      <div className="card asset-history-card"><p className="eyebrow">Record history</p><h2>Asset history</h2>{asset.history?.length ? <div className="asset-history-list">{[...asset.history].reverse().map((entry) => <article className="asset-history-entry" key={entry._id || `${entry.at}-${entry.action}`}><div><b>{entry.action}</b><small>{entry.by || 'System'} · {entry.at ? new Date(entry.at).toLocaleString('en-PH') : 'Date unavailable'}</small></div>{entry.note && <p>{entry.note}</p>}</article>)}</div> : <p className="sub">No history recorded yet.</p>}</div>
    </div><aside className="detail-side"><div className="card qr-card"><p className="eyebrow">Scan asset code</p>{qrImage ? <img className="qr" src={qrImage} alt={`QR code for inventory tag ${asset.inventoryTag}`} /> : <p className="sub">Preparing QR code…</p>}<b>{asset.inventoryTag}</b><p className="qr-card-name">{asset.name}</p>{asset.description && <p className="qr-card-description">{asset.description}</p>}<button className="btn block" disabled={downloading} onClick={downloadLabel}>{downloading ? 'Preparing…' : 'Download label'}</button>{(downloadError || qrError) && <p className="form-error" role="alert">{downloadError || qrError}</p>}</div>{locked && <div className="card"><h2>Disposed asset</h2><p className="sub">This record is read-only and kept for audit history.</p></div>}</aside></div>
    {editing && <AssetModal asset={asset} onClose={() => setEditing(false)} onSaved={(saved) => { setAsset(saved); setEditing(false); }} />}
    {confirmDelete && <div className="modal-backdrop"><div className="modal-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-asset-title"><div className="modal-heading"><p className="eyebrow">Destructive action</p><h2 id="delete-asset-title">Delete asset?</h2><p className="sub">This permanently removes {asset.inventoryTag} from the register. Use this only for an incorrect or duplicate record.</p></div>{deleteError && <p className="form-error" role="alert">{deleteError}</p>}<div className="modal-actions"><button className="btn" onClick={() => setConfirmDelete(false)} disabled={deleteBusy}>Cancel</button><button className="btn danger" onClick={deleteAsset} disabled={deleteBusy}>{deleteBusy ? 'Deleting…' : 'Delete permanently'}</button></div></div></div>}
  </div>;
}
