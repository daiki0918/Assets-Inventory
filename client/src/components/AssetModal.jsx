import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import DrawerPortal from './DrawerPortal';

const emptyForm = { cluster: '', branch: '', location: '', name: '', category: '', description: '', condition: 'Good', serialNo: '', purchaseDate: '', cost: '', salvageValue: 0, usefulLifeYears: 5, quantity: 1 };
const ANIMATION_MS = 300; // keep in sync with the CSS transition duration

export default function AssetModal({ asset, onClose, onSaved }) {
  const { meta, reloadMeta } = useAuth();
  const [form, setForm] = useState(() => asset ? {
    cluster: asset.cluster?._id || '', branch: asset.branch?._id || '', location: asset.location?._id || '',
    name: asset.name || '', category: asset.category || '', description: asset.description || '', condition: asset.condition || 'Good', serialNo: asset.serialNo || '',
    purchaseDate: asset.purchaseDate?.slice(0, 10) || '', cost: asset.cost ?? '', salvageValue: asset.salvageValue ?? 0, usefulLifeYears: asset.usefulLifeYears ?? 5,
  } : emptyForm);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [open, setOpen] = useState(false); // drives the slide-in / slide-out
  const closeTimer = useRef(null);
  const isEditing = Boolean(asset);
  const cluster = meta.clusters.find((item) => item._id === form.cluster);
  const branches = useMemo(() => cluster ? meta.branches.filter((item) => String(item.cluster?._id || item.cluster) === cluster._id) : [], [cluster, meta.branches]);
  const locations = useMemo(() => meta.locations.filter((item) => String(item.branch?._id || item.branch) === form.branch), [form.branch, meta.locations]);
  const set = (key) => (event) => {
    setReviewing(false);
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  // Slide in after the first paint so the transition actually runs
  useEffect(() => {
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Lock page scroll while the drawer is open
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // Slide out, then tell the parent
  const animateOut = useCallback((done) => {
    setOpen(false);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(done, ANIMATION_MS);
  }, []);

  const requestClose = useCallback(() => {
    if (!busy) animateOut(onClose);
  }, [busy, animateOut, onClose]);

  // Close on Escape
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && requestClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose]);

  useEffect(() => {
    if (!isEditing && !form.cluster && meta.clusters.length === 1) setForm((current) => ({ ...current, cluster: meta.clusters[0]._id }));
  }, [isEditing, form.cluster, meta.clusters]);

  const validate = () => {
    setError('');
    if (!form.name.trim()) { setError('Asset name is required.'); return false; }
    if (!form.branch) { setError('Select a branch.'); return false; }
    if (!form.location) { setError('Select a location.'); return false; }
    if (!isEditing && (!Number.isInteger(Number(form.quantity)) || Number(form.quantity) < 1 || Number(form.quantity) > 500)) {
      setError('Quantity must be a whole number between 1 and 500.');
      return false;
    }
    for (const [field, label] of [['cost', 'Cost'], ['salvageValue', 'Salvage value']]) {
      if (form[field] !== '' && (Number.isNaN(Number(form[field])) || Number(form[field]) < 0)) {
        setError(`${label} must be a non-negative number.`);
        return false;
      }
    }
    if (Number(form.usefulLifeYears) < 1) { setError('Useful life must be at least 1 year.'); return false; }
    return true;
  };
  const save = async (event) => {
    event?.preventDefault();
    if (!validate()) return;
    setBusy(true);
    try {
      const saved = await api(isEditing ? `/assets/${asset._id}` : '/assets', { method: isEditing ? 'PUT' : 'POST', body: form });
      setBusy(false);
      animateOut(() => onSaved(saved));
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!validate()) return;
    if (!isEditing) {
      setBusy(true);
      try {
        await reloadMeta();
        setReviewing(true);
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
      return;
    }
    save();
  };
  const selectedBranch = branches.find((item) => item._id === form.branch);
  const previewAssets = !isEditing && selectedBranch
    ? Array.from({ length: Math.min(Number(form.quantity) || 0, 500) }, (_, index) => ({
      tag: `${selectedBranch.prefix}-${String((Number(selectedBranch.seq) || 0) + index + 1).padStart(4, '0')}`,
      name: form.name.trim() || 'Unnamed asset',
    }))
    : [];

  return (
    <DrawerPortal>
      <div
        className={`modal-backdrop asset-drawer-backdrop ${open ? 'is-open' : ''}`}
        role="presentation"
        onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
      >
        <div className="asset-drawer" role="dialog" aria-modal="true" aria-labelledby="asset-modal-title">
          <div className="asset-drawer-header">
            <div className="modal-heading">
              <p className="eyebrow">{isEditing ? 'Update record' : 'New inventory record'}</p>
              <h2 id="asset-modal-title">{isEditing ? 'Edit asset' : 'Register asset'}</h2>
              <p className="sub">{isEditing ? 'Update the details below. Changes are recorded in history.' : 'Add an asset and generate its QR tag automatically.'}</p>
            </div>
            <button className="modal-close" type="button" onClick={requestClose} disabled={busy} aria-label="Close asset form">×</button>
          </div>

          <form className="asset-drawer-form" onSubmit={submit}>
            <div className="asset-drawer-body">
            <div className="form-section"><h3>Location</h3><div className="form-grid">
              <div><label htmlFor="asset-cluster">Cluster</label><select id="asset-cluster" required value={form.cluster} onChange={(event) => { setReviewing(false); setForm({ ...form, cluster: event.target.value, branch: '', location: '' }); }}><option value="">Select cluster</option>{meta.clusters.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></div>
              <div><label htmlFor="asset-branch">Branch</label><select id="asset-branch" required value={form.branch} disabled={!form.cluster} onChange={(event) => { setReviewing(false); setForm({ ...form, branch: event.target.value, location: '' }); }}><option value="">Select branch</option>{branches.map((item) => <option key={item._id} value={item._id}>{item.name} ({item.prefix})</option>)}</select></div>
              <div><label htmlFor="asset-location">Location / room</label><select id="asset-location" required value={form.location} disabled={!form.branch} onChange={set('location')}><option value="">Select location</option>{locations.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></div>
            </div></div>

            <div className="form-section"><h3>Asset details</h3><div className="form-grid">
              <div className="wide"><label htmlFor="asset-name">Asset name</label><input id="asset-name" required value={form.name} onChange={set('name')} placeholder="e.g. Reception sofa" /></div>
              <div><label htmlFor="asset-category">Category</label><input id="asset-category" value={form.category} onChange={set('category')} placeholder="e.g. Furniture" /></div>
              <div><label htmlFor="asset-serial">Serial number</label><input id="asset-serial" value={form.serialNo} onChange={set('serialNo')} placeholder="Optional" />{!isEditing && Number(form.quantity) > 1 && <small className="field-hint">Assigned to the first asset only; add other units’ serials separately.</small>}</div>
              <div className="wide"><label htmlFor="asset-description">Description / Brand / Model</label><textarea id="asset-description" rows="2" value={form.description} onChange={set('description')} placeholder="e.g. 3 Seater / Color Black" /></div>
              {isEditing && <div><label htmlFor="asset-condition">Condition</label><input id="asset-condition" maxLength="120" value={form.condition} onChange={set('condition')} placeholder="e.g. Good, worn upholstery" /></div>}
              {!isEditing && <div><label htmlFor="asset-quantity">Quantity</label><input id="asset-quantity" type="number" min="1" max="500" step="1" required value={form.quantity} onChange={set('quantity')} /><small className="field-hint">Creates one separately tracked record per physical asset.</small></div>}
            </div></div>

            <div className="form-section"><h3>Value and dates</h3><div className="form-grid">
              <div><label htmlFor="asset-purchase-date">Purchase date</label><input id="asset-purchase-date" type="date" value={form.purchaseDate} onChange={set('purchaseDate')} /></div>
              <div><label htmlFor="asset-cost">Cost (₱)</label><input id="asset-cost" type="number" min="0" step="0.01" value={form.cost} onChange={set('cost')} placeholder="Optional" />{!isEditing && Number(form.quantity) > 1 && <small className="field-hint">Cost is for each individual asset.</small>}</div>
              <div><label htmlFor="asset-salvage">Salvage value (₱)</label><input id="asset-salvage" type="number" min="0" step="0.01" value={form.salvageValue} onChange={set('salvageValue')} /></div>
              <div><label htmlFor="asset-life">Useful life (years)</label><input id="asset-life" type="number" min="1" step="1" value={form.usefulLifeYears} onChange={set('usefulLifeYears')} /></div>
            </div></div>

            {reviewing && <section className="asset-registration-preview" aria-live="polite">
              <p className="eyebrow">Registration preview</p>
              <h3>{previewAssets.length} individual {previewAssets.length === 1 ? 'asset' : 'assets'} will be created</h3>
              <p className="sub">Each asset gets its own code, QR identifier, status, location, and history. These codes are estimates; the server assigns the final codes when you confirm.</p>
              <div className="asset-preview-list">{previewAssets.map((item, index) => <div className="asset-preview-row" key={`${item.tag}-${index}`}><span>{item.name}</span><b>{item.tag}</b></div>)}</div>
              <p className="sub">Cost is applied per asset. The entered serial number is assigned to the first record; add other units’ serial numbers individually after registration.</p>
            </section>}
            {error && <p className="form-error" role="alert">{error}</p>}
            </div>

            {/* Pinned footer so the buttons are always reachable */}
            <div className="asset-drawer-footer">
              {reviewing ? <>
                <button className="btn" type="button" onClick={() => setReviewing(false)} disabled={busy}>Edit details</button>
                <button className="btn blue" type="button" onClick={save} disabled={busy}>{busy ? 'Registering…' : `Confirm & register ${previewAssets.length} ${previewAssets.length === 1 ? 'asset' : 'assets'}`}</button>
              </> : <>
                <button className="btn" type="button" onClick={requestClose} disabled={busy}>Cancel</button>
                <button className="btn blue" disabled={busy}>{busy ? (isEditing ? 'Saving…' : 'Preparing preview…') : isEditing ? 'Save changes' : 'Review registration'}</button>
              </>}
            </div>
          </form>
        </div>
      </div>
    </DrawerPortal>
  );
}