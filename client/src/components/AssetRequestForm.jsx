import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import DrawerPortal from './DrawerPortal';

const emptyForm = { name: '', category: '', quantity: '1', note: '' };
const ANIMATION_MS = 300;

export default function AssetRequestForm({ onClose, onCreated }) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      clearTimeout(closeTimer.current);
    };
  }, []);

  const requestClose = useCallback((force = false) => {
    if (busy && !force) return;
    setOpen(false);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(onClose, ANIMATION_MS);
  }, [busy, onClose]);

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') requestClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [requestClose]);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/asset-requests', { method: 'POST', body: { ...form, quantity: Number(form.quantity) } });
      onCreated();
      requestClose(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return <DrawerPortal>
    <div className={`modal-backdrop asset-drawer-backdrop ${open ? 'is-open' : ''}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <aside className="asset-drawer" role="dialog" aria-modal="true" aria-labelledby="asset-request-title">
        <header className="asset-drawer-header">
          <div className="modal-heading"><p className="eyebrow">Branch request</p><h2 id="asset-request-title">Request a new asset</h2><p className="sub">Send an asset request to the asset admin for review.</p></div>
          <button className="modal-close" type="button" onClick={requestClose} disabled={busy} aria-label="Close asset request form">×</button>
        </header>
        <form className="asset-drawer-form asset-request-drawer-form" onSubmit={submit}>
          <div className="asset-drawer-body">
            <div className="form-section"><h3>Request details</h3><div className="form-grid">
              <div className="wide"><label htmlFor="asset-request-name">Asset name</label><input id="asset-request-name" required maxLength="160" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Office laptop" /></div>
              <div><label htmlFor="asset-request-category">Category</label><input id="asset-request-category" maxLength="100" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="e.g. IT equipment" /></div>
              <div><label htmlFor="asset-request-quantity">Quantity</label><input id="asset-request-quantity" type="number" min="1" max="500" step="1" required value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></div>
              <div className="wide"><label htmlFor="asset-request-note">Reason / details</label><textarea id="asset-request-note" rows="4" maxLength="500" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Why does your branch need this asset?" /></div>
            </div></div>
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>
          <footer className="asset-drawer-footer"><button className="btn" type="button" onClick={requestClose} disabled={busy}>Cancel</button><button className="btn blue" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button></footer>
        </form>
      </aside>
    </div>
  </DrawerPortal>;
}
