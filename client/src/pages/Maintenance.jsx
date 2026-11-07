import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, peso } from "../lib/api";
import DrawerPortal from "../components/DrawerPortal";
import Empty from "../components/Empty";
import PageHeader from "../components/PageHeader";
import Pagination from "../components/Pagination";
import useRealtimeRefresh from "../lib/useRealtimeRefresh";

const initial = {
  asset: "",
  performedAt: "",
  nextDue: "",
  status: "Scheduled",
  cost: "",
  vendor: "",
  note: "",
};
const ANIMATION_MS = 300; // keep in sync with the CSS transition duration

function MaintenanceDrawer({ assets, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false); // drives slide-in / slide-out
  const closeTimer = useRef(null);
  const set = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  // Slide in after first paint so the transition runs
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => setOpen(true)),
    );
    return () => cancelAnimationFrame(frame);
  }, []);

  // Lock page scroll while open
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
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
    const onKey = (event) => event.key === "Escape" && requestClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const submit = async (event) => {
    event.preventDefault();
    const asset = assets.find((item) => item._id === form.asset);
    if (!asset) return setError("Select an asset.");
    setBusy(true);
    setError("");
    try {
      await api(`/assets/${asset._id}/maintenance`, {
        method: "POST",
        body: form,
      });
      setBusy(false);
      animateOut(onSaved);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <DrawerPortal>
      <div
        className={`modal-backdrop asset-drawer-backdrop ${open ? "is-open" : ""}`}
        role="presentation"
        onMouseDown={(event) =>
          event.target === event.currentTarget && requestClose()
        }
      >
      <div
        className="asset-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="maintenance-modal-title"
      >
        <div className="asset-drawer-header">
          <div className="modal-heading">
            <p className="eyebrow">New maintenance entry</p>
            <h2 id="maintenance-modal-title">Record service</h2>
            <p className="sub">Add a scheduled or completed service record.</p>
          </div>
          <button
            className="modal-close"
            type="button"
            onClick={requestClose}
            disabled={busy}
            aria-label="Close maintenance form"
          >
            ×
          </button>
        </div>

        <form className="asset-drawer-form" onSubmit={submit}>
          <div className="asset-drawer-body">
            <div className="form-section">
              <h3>Service</h3>
              <div className="form-grid">
                <div className="wide">
                  <label htmlFor="maintenance-asset">Asset</label>
                  <select
                    id="maintenance-asset"
                    required
                    value={form.asset}
                    onChange={set("asset")}
                  >
                    <option value="">Select asset</option>
                    {assets
                      .filter((asset) => asset.status !== "Disposed")
                      .map((asset) => (
                        <option key={asset._id} value={asset._id}>
                          {asset.inventoryTag} · {asset.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="maintenance-page-status">Status</label>
                  <select
                    id="maintenance-page-status"
                    value={form.status}
                    onChange={set("status")}
                  >
                    <option>Scheduled</option>
                    <option>Completed</option>
                    <option>Cancelled</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="maintenance-page-vendor">Vendor</label>
                  <input
                    id="maintenance-page-vendor"
                    value={form.vendor}
                    onChange={set("vendor")}
                    placeholder="Optional"
                  />
                </div>
              </div>
            </div>

            <div className="form-section">
              <h3>Dates and cost</h3>
              <div className="form-grid">
                <div>
                  <label htmlFor="maintenance-page-performed">Performed</label>
                  <input
                    id="maintenance-page-performed"
                    type="date"
                    value={form.performedAt}
                    onChange={set("performedAt")}
                  />
                </div>
                <div>
                  <label htmlFor="maintenance-page-due">Next due</label>
                  <input
                    id="maintenance-page-due"
                    type="date"
                    value={form.nextDue}
                    onChange={set("nextDue")}
                  />
                </div>
                <div className="wide">
                  <label htmlFor="maintenance-page-cost">Cost (₱)</label>
                  <input
                    id="maintenance-page-cost"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.cost}
                    onChange={set("cost")}
                    placeholder="Optional"
                  />
                </div>
              </div>
            </div>

            <div className="form-section">
              <h3>Notes</h3>
              <label htmlFor="maintenance-page-note" className="sr-only">
                Notes
              </label>
              <textarea
                id="maintenance-page-note"
                rows="4"
                value={form.note}
                onChange={set("note")}
                placeholder="Optional"
              />
            </div>

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>

          <div className="asset-drawer-footer">
            <button
              className="btn"
              type="button"
              onClick={requestClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button className="btn blue" disabled={busy}>
              {busy ? "Saving…" : "Save maintenance"}
            </button>
          </div>
        </form>
      </div>
      </div>
    </DrawerPortal>
  );
}

export default function Maintenance() {
  const { user } = useAuth();
  const [assets, setAssets] = useState([]);
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const load = () =>
    api("/assets")
      .then(setAssets)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);
  useRealtimeRefresh(load);

  const records = useMemo(
    () =>
      assets
        .flatMap((asset) =>
          (asset.maintenance || []).map((item) => ({ ...item, asset })),
        )
        .filter((item) => {
          const text =
            `${item.asset.inventoryTag} ${item.asset.name} ${item.vendor || ""} ${item.note || ""}`.toLowerCase();
          const due = item.nextDue && new Date(item.nextDue) < new Date();
          return (
            text.includes(query.toLowerCase()) &&
            (filter === "all" ||
              (filter === "overdue"
                ? due && item.status === "Scheduled"
                : item.status === filter))
          );
        })
        .sort(
          (a, b) =>
            new Date(a.nextDue || a.performedAt || 0) -
            new Date(b.nextDue || b.performedAt || 0),
        ),
    [assets, query, filter],
  );
  const visibleRecords = records.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [query, filter]);

  const handleSaved = useCallback(() => {
    setFormOpen(false);
    load();
  }, []);
  const handleClose = useCallback(() => setFormOpen(false), []);

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Maintenance"
        description="Track scheduled work, overdue service, vendors, and costs across your assets."
        action={
          <>
            <button
              className="btn blue maintenance-action"
              onClick={() => setFormOpen(true)}
              disabled={user.role !== "superadmin"}
            >
              Add maintenance
            </button>
            <button className="btn maintenance-action" onClick={load}>
              Refresh
            </button>
          </>
        }
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="operation-layout single-operation">
        <div className="card maintenance-list-card">
          <form
            className="asset-toolbar operation-search"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(searchInput.trim());
            }}
          >
            <div className="search-field">
              <span>⌕</span>
              <input
                aria-label="Search maintenance"
                placeholder="Search tag, vendor, or note"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <button className="btn blue" type="submit">
              Search
            </button>
            <select
              aria-label="Maintenance filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All records</option>
              <option value="overdue">Overdue</option>
              <option value="Scheduled">Scheduled</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </form>
          <div className="operation-list maintenance-table">
            <div className="maintenance-head" aria-hidden="true">
              <span>Asset</span>
              <span>Status / vendor</span>
              <span>Next due / cost</span>
            </div>
            {visibleRecords.map((item, index) => (
              <div
                className="operation-row maintenance-row"
                key={item._id || `${item.asset._id}-${index}`}
              >
                <span className="maintenance-asset" data-label="Asset">
                  <Link to={`/a/${item.asset.qrToken}`}>
                    <b>{item.asset.inventoryTag}</b>
                  </Link>
                  <small>{item.asset.name}</small>
                </span>
                <span className="maintenance-status" data-label="Status / vendor">
                  <b>{item.status}</b>
                  <small>{item.vendor || "No vendor"}</small>
                </span>
                <span className="maintenance-due" data-label="Next due / cost">
                  {item.nextDue
                    ? new Date(item.nextDue).toLocaleDateString("en-PH")
                    : "—"}
                  <small>{item.cost ? peso(item.cost) : "No cost"}</small>
                </span>
              </div>
            ))}
            {!records.length && (
              <Empty
                title="No maintenance records"
                text="Add a schedule or completed service record."
              />
            )}
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={records.length}
            onChange={setPage}
          />
        </div>
      </div>

      {formOpen && (
        <MaintenanceDrawer
          assets={assets}
          onClose={handleClose}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}