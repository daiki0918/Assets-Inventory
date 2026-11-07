import { useEffect, useMemo, useState } from 'react';
import { createAssetQr } from '../lib/assetQr';

export default function QrLabelsModal({ assets, onClose }) {
  const uniqueAssets = useMemo(() => {
    const seen = new Set();
    return assets.filter((asset) => {
      const identity = asset._id || asset.qrToken || asset.inventoryTag;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }, [assets]);
  const [selected, setSelected] = useState(() => new Set(uniqueAssets.map((asset) => asset._id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [qrImages, setQrImages] = useState({});
  const [qrError, setQrError] = useState('');
  const chosen = useMemo(() => uniqueAssets.filter((asset) => selected.has(asset._id)), [uniqueAssets, selected]);
  useEffect(() => {
    let cancelled = false;
    setQrError('');
    Promise.all(chosen.map(async (asset) => [asset._id, await createAssetQr(asset.inventoryTag)]))
      .then((entries) => {
        if (!cancelled) setQrImages(Object.fromEntries(entries));
      })
      .catch((qrGenerationError) => {
        if (!cancelled) setQrError(qrGenerationError.message);
      });
    return () => { cancelled = true; };
  }, [chosen]);
  const toggle = (id) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectAll = () => setSelected((current) => current.size === uniqueAssets.length ? new Set() : new Set(uniqueAssets.map((asset) => asset._id)));
  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const { downloadQrLabels } = await import('../lib/qrLabels');
      await downloadQrLabels(chosen);
    } catch (downloadError) { setError(downloadError.message); } finally { setBusy(false); }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="modal-dialog qr-label-modal" role="dialog" aria-modal="true" aria-labelledby="qr-label-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" type="button" onClick={onClose} aria-label="Close QR labels">×</button>
      <div className="modal-heading"><p className="eyebrow">Word download</p><h2 id="qr-label-title">QR labels</h2><p className="sub">Choose assets and download a formal A4 Word document with branded QR codes and cutting lines.</p></div>
      <div className="qr-label-toolbar"><button className="btn compact-action" type="button" onClick={selectAll}>{selected.size === uniqueAssets.length ? 'Clear all' : 'Select all'}</button><span>{selected.size} of {uniqueAssets.length} selected</span></div>
      <div className="qr-asset-picker">{uniqueAssets.map((asset) => <label className="qr-asset-option" key={asset._id}><input type="checkbox" checked={selected.has(asset._id)} onChange={() => toggle(asset._id)} /><span><b>{asset.inventoryTag}</b><small>{asset.name} · {asset.location?.name || 'No location'}</small></span></label>)}</div>
      <div className="qr-sheet" aria-label="QR label preview">{chosen.map((asset) => <div className="qr-label" key={asset._id}>{qrImages[asset._id] ? <img src={qrImages[asset._id]} alt={`QR code for inventory tag ${asset.inventoryTag}`} /> : <span className="qr-preview-pending">Preparing QR…</span>}<span className="qr-label-content"><small className="qr-label-brand">COSMOPOLITAN FUNERAL HOMES-INC.</small><b>{asset.inventoryTag}</b><strong>{asset.name}</strong>{asset.description && <small className="qr-label-description">{asset.description}</small>}{asset.category && <small>{asset.category}</small>}{asset.serialNo && <small>SN: {asset.serialNo}</small>}</span></div>)}</div>
      {(error || qrError) && <p className="form-error" role="alert">{error || qrError}</p>}
      <div className="modal-actions"><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn blue" type="button" disabled={!chosen.length || busy} onClick={download}>{busy ? 'Preparing…' : `Download ${chosen.length || ''} labels`}</button></div>
    </div>
  </div>;
}
