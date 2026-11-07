import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import DrawerPortal from '../components/DrawerPortal';
import Empty from '../components/Empty';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';

const MAX_CHIPS = 3;
const ANIMATION_MS = 300; // keep in sync with the CSS transition duration

function BranchDrawer({ item, clusters, onClose, onSaved }) {
  const isEditing = Boolean(item);
  const [form, setForm] = useState(() => ({
    name: item?.name || '',
    prefix: item?.prefix || '',
    cluster: item?.cluster?._id || item?.cluster || (clusters.length === 1 ? clusters[0]._id : ''),
    locations: item?.locations?.map((location) => ({
      _id: location._id,
      name: location.name,
      assetCount: location.assetCount || 0,
      removed: false,
      relocateTo: '',
    })) || [],
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false); // drives slide-in / slide-out
  const closeTimer = useRef(null);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  // Slide in after first paint so the transition runs
  useEffect(() => {
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Lock page scroll while open
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

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('Branch name is required.');
    if (!form.prefix.trim()) return setError('Prefix is required.');
    if (!form.cluster) return setError('Select a cluster.');
    const locationNames = new Set();
    const locations = [];
    const relocations = [];
    for (const location of form.locations) {
      if (location.removed) {
        if (location.assetCount > 0) {
          const targetRemains = form.locations.some(
            (entry) => entry._id === location.relocateTo && !entry.removed,
          );
          if (!targetRemains) return setError(`Choose a location that will remain for assets from "${location.name}".`);
          relocations.push({ locationId: location._id, targetLocationId: location.relocateTo });
        }
        continue;
      }
      const name = location.name.trim();
      if (!name && location._id) return setError('Existing locations need a name. Remove a location to delete it.');
      if (!name) continue;
      if (locationNames.has(name.toLowerCase())) return setError(`Location "${name}" is listed more than once.`);
      locationNames.add(name.toLowerCase());
      locations.push({ ...(location._id ? { id: location._id } : {}), name });
    }
    setBusy(true);
    try {
      const saved = await api(isEditing ? `/admin/branches/${item._id}` : '/admin/branches', {
        method: isEditing ? 'PUT' : 'POST',
        body: { ...form, locations, relocations, name: form.name.trim(), prefix: form.prefix.trim().toUpperCase() },
      });
      setBusy(false);
      animateOut(() => onSaved(saved));
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <DrawerPortal>
      <div
        className={`modal-backdrop asset-drawer-backdrop ${open ? 'is-open' : ''}`}
        role="presentation"
        onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
      >
      <div className="asset-drawer" role="dialog" aria-modal="true" aria-labelledby="branch-drawer-title">
        <div className="asset-drawer-header">
          <div className="modal-heading">
            <p className="eyebrow">{isEditing ? 'Update record' : 'New branch'}</p>
            <h2 id="branch-drawer-title">{isEditing ? 'Edit branch' : 'Add branch'}</h2>
            <p className="sub">
              {isEditing
                ? 'Update the branch details below.'
                : 'Create a branch with its own prefix for inventory tags.'}
            </p>
          </div>
          <button className="modal-close" type="button" onClick={requestClose} disabled={busy} aria-label="Close branch form">×</button>
        </div>

        <form className="asset-drawer-form" onSubmit={submit}>
          <div className="asset-drawer-body">
            <div className="form-section">
              <h3>Branch details</h3>
              <div className="form-grid">
                <div className="wide">
                  <label htmlFor="branch-name">Branch name</label>
                  <input id="branch-name" required value={form.name} onChange={set('name')} placeholder="e.g. Junquera" />
                </div>
                <div>
                  <label htmlFor="branch-prefix">Prefix</label>
                  <input
                    id="branch-prefix"
                    required
                    value={form.prefix}
                    onChange={(event) => setForm((current) => ({ ...current, prefix: event.target.value.toUpperCase() }))}
                    placeholder="e.g. JNQ"
                  />
                </div>
                <div>
                  <label htmlFor="branch-cluster">Cluster</label>
                  <select id="branch-cluster" required value={form.cluster} onChange={set('cluster')}>
                    <option value="">Select cluster</option>
                    {clusters.map((cluster) => <option key={cluster._id} value={cluster._id}>{cluster.name}</option>)}
                  </select>
                </div>
                <div className="wide">
                  <div className="branch-location-label" id="branch-locations-label">Locations</div>
                  <div
                    className="branch-location-list"
                    role="group"
                    aria-labelledby="branch-locations-label"
                    aria-describedby="branch-locations-help"
                  >
                    {form.locations.map((location, index) => (
                      <div className="branch-location-row" key={location._id || `new-${index}`}>
                        <input
                          aria-label={`Location ${index + 1}`}
                          value={location.name}
                          disabled={location.removed}
                          onChange={(event) => setForm((current) => ({
                            ...current,
                            locations: current.locations.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, name: event.target.value } : entry,
                            ),
                          }))}
                          placeholder="e.g. Ground Floor"
                        />
                        {location.removed && location.assetCount > 0 && (
                          <select
                            aria-label={`Move assets from ${location.name} to`}
                            value={location.relocateTo}
                            onChange={(event) => setForm((current) => ({
                              ...current,
                              locations: current.locations.map((entry, entryIndex) =>
                                entryIndex === index ? { ...entry, relocateTo: event.target.value } : entry,
                              ),
                            }))}
                          >
                            <option value="">Move {location.assetCount} asset{location.assetCount === 1 ? '' : 's'} to…</option>
                            {form.locations
                              .filter((entry) => entry._id && !entry.removed && entry._id !== location._id)
                              .map((entry) => <option key={entry._id} value={entry._id}>{entry.name}</option>)}
                          </select>
                        )}
                        <button
                          className="btn btn-sm"
                          type="button"
                          onClick={() => setForm((current) => ({
                            ...current,
                            locations: location._id && location.assetCount > 0
                              ? current.locations.map((entry, entryIndex) =>
                                entryIndex === index ? { ...entry, removed: !entry.removed, relocateTo: '' } : entry,
                              )
                              : current.locations.filter((_, entryIndex) => entryIndex !== index),
                          }))}
                          aria-label={`${location.removed ? 'Keep' : 'Remove'} location ${index + 1}`}
                        >
                          {location.removed ? 'Keep' : 'Remove'}
                        </button>
                      </div>
                    ))}
                    <button
                      className="btn btn-sm"
                      type="button"
                      onClick={() => setForm((current) => ({
                        ...current,
                        locations: [...current.locations, { name: '' }],
                      }))}
                    >
                      Add location
                    </button>
                  </div>
                  <p className="sub" id="branch-locations-help">
                    Edit names or add locations. Removing a location with assets requires moving them to another existing location.
                  </p>
                </div>
              </div>
            </div>

            {error && <p className="form-error" role="alert">{error}</p>}
          </div>

          <div className="asset-drawer-footer">
            <button className="btn" type="button" onClick={requestClose} disabled={busy}>Cancel</button>
            <button className="btn blue" disabled={busy}>{busy ? 'Saving…' : isEditing ? 'Save changes' : 'Add branch'}</button>
          </div>
        </form>
      </div>
      </div>
    </DrawerPortal>
  );
}

export default function Branches() {
  const { meta, reloadMeta } = useAuth();
  const [branches, setBranches] = useState(meta.branches);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pageSize = 10;
  useEffect(() => { setBranches(meta.branches); }, [meta.branches]);

  const rows = useMemo(
    () =>
      branches
        .filter((branch) =>
          `${branch.name} ${branch.prefix} ${branch.cluster?.name || ''}`.toLowerCase().includes(query.toLowerCase()),
        )
        .map((branch) => ({
          ...branch,
          locations: meta.locations.filter((location) => String(location.branch?._id || location.branch) === String(branch._id)),
        })),
    [branches, meta.locations, query],
  );
  const visible = rows.slice((page - 1) * pageSize, page * pageSize);

  const save = async (saved) => {
    setModal(null);
    const withCluster = { ...saved, cluster: meta.clusters.find((cluster) => cluster._id === saved.cluster) };
    setBranches((current) =>
      current.some((branch) => branch._id === saved._id)
        ? current.map((branch) => (branch._id === saved._id ? withCluster : branch))
        : [...current, withCluster],
    );
    try { await reloadMeta(); } catch (e) { setError(e.message); }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/admin/branches/${deleteTarget._id}`, { method: 'DELETE' });
      setBranches((current) => current.filter((branch) => branch._id !== deleteTarget._id));
      setDeleteTarget(null);
      await reloadMeta();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const closeDrawer = useCallback(() => setModal(null), []);

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Branches & locations"
        description="View all branch prefixes, clusters, and rooms available to the register."
        action={<button className="btn blue" onClick={() => setModal({})}>Add branch</button>}
      />

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="card report-toolbar branch-toolbar">
        <input
          aria-label="Search branches"
          placeholder="Search branch, prefix, or cluster"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
        />
        <span className="branch-count">{rows.length} {rows.length === 1 ? 'branch' : 'branches'}</span>
      </div>

      <div className="card report-table branch-table">
        {!rows.length ? (
          <Empty title="No branches found" text="No branches match your search." />
        ) : (
          <>
            <div className="report-head branch-head" aria-hidden="true">
              <span>Branch</span>
              <span>Prefix</span>
              <span>Cluster</span>
              <span>Locations</span>
              <span>Sequence</span>
              <span className="actions-col">Actions</span>
            </div>

            {visible.map((branch) => {
              const shown = branch.locations.slice(0, MAX_CHIPS);
              const extra = branch.locations.length - shown.length;
              return (
                <div className="report-row branch-row" key={branch._id}>
                  <span className="cell-name" data-label="Branch"><b>{branch.name}</b></span>
                  <span data-label="Prefix"><code className="prefix-pill">{branch.prefix}</code></span>
                  <span data-label="Cluster">{branch.cluster?.name || '—'}</span>
                  <span className="cell-locations" data-label="Locations">
                    {branch.locations.length ? (
                      <>
                        {shown.map((location) => <span className="chip" key={location._id}>{location.name}</span>)}
                        {extra > 0 && (
                          <span className="chip chip-more" title={branch.locations.slice(MAX_CHIPS).map((l) => l.name).join(', ')}>
                            +{extra}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="muted">No locations</span>
                    )}
                  </span>
                  <span data-label="Sequence">{branch.seq || 0}</span>
                  <span className="row-actions" data-label="Actions">
                    <button className="btn btn-sm" onClick={() => setModal(branch)} aria-label={`Edit ${branch.name}`}>Edit</button>
                    <button className="btn btn-sm btn-danger-ghost" onClick={() => setDeleteTarget(branch)} aria-label={`Delete ${branch.name}`}>Delete</button>
                  </span>
                </div>
              );
            })}

            <Pagination page={page} pageSize={pageSize} total={rows.length} onChange={setPage} />
          </>
        )}
      </div>

      {modal && (
        <BranchDrawer
          item={modal._id ? modal : null}
          clusters={meta.clusters}
          onClose={closeDrawer}
          onSaved={save}
        />
      )}

      {deleteTarget && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && setDeleteTarget(null)}>
          <div className="modal-dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-branch-title">
            <div className="modal-heading">
              <p className="eyebrow">Destructive action</p>
              <h2 id="delete-branch-title">Delete branch?</h2>
              <p className="sub">This permanently removes <b>{deleteTarget.name}</b> if it has no assets, locations, or users.</p>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setDeleteTarget(null)} disabled={busy}>Cancel</button>
              <button className="btn danger" onClick={remove} disabled={busy}>{busy ? 'Deleting…' : 'Delete permanently'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}