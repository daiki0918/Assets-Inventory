import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AdminFormModal from '../components/AdminFormModal';
import Empty from '../components/Empty';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import useRealtimeRefresh from '../lib/useRealtimeRefresh';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const pageSize = 10;
  const load = () => api('/admin/users').then(setUsers).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  useRealtimeRefresh(load);
  const rows = users.filter((user) => `${user.name} ${user.email} ${user.role} ${user.branch?.name || ''}`.toLowerCase().includes(query.toLowerCase()));
  const visible = rows.slice((page - 1) * pageSize, page * pageSize);
  const save = (saved) => { setUsers((current) => saved._id === current.find((user) => user._id === saved._id)?._id ? current.map((user) => user._id === saved._id ? saved : user) : [...current, saved]); setModal(null); };
  const remove = async () => { setBusy(true); setError(''); try { await api(`/admin/users/${deleteTarget._id}`, { method: 'DELETE' }); setUsers((current) => current.filter((user) => user._id !== deleteTarget._id)); setDeleteTarget(null); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return <>
    <PageHeader
      eyebrow="Administration"
      title="Users"
      description="Review user accounts, roles, and assigned branches."
      action={
        <>
          <button className="btn" onClick={() => api('/admin/users').then(setUsers).catch((e) => setError(e.message))}>Refresh</button>
          <button className="btn blue" onClick={() => setModal({})}>Add user</button>
        </>
      }
    />
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="card report-toolbar users-toolbar">
      <input
        aria-label="Search users"
        placeholder="Search name, email, role, or branch"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setPage(1); }}
      />
      <span className="muted">{rows.length} {rows.length === 1 ? 'user' : 'users'}</span>
    </div>
    <div className="card report-table users-table">
      {!rows.length ? (
        <Empty title="No users found" text="No accounts match your search." />
      ) : (
        <>
          <div className="report-head users-head" aria-hidden="true">
            <span>User</span><span>Email</span><span>Role</span><span>Branch</span><span>Actions</span>
          </div>
          {visible.map((user) => {
            const name = user.name || 'Unnamed user';
            const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
            return (
              <div className="report-row users-row" key={user._id}>
                <span className="users-identity" data-label="User">
                  <span className="users-avatar" aria-hidden="true">{initials || 'U'}</span>
                  <b>{name}</b>
                </span>
                <span className="users-email" data-label="Email">{user.email}</span>
                <span data-label="Role"><span className={`role-pill ${user.role === 'superadmin' ? 'is-admin' : 'is-operator'}`}>{user.role === 'superadmin' ? 'Super admin' : 'Operator'}</span></span>
                <span data-label="Branch">{user.branch?.name ? <span className="users-branch">{user.branch.name}</span> : <span className="muted">All branches</span>}</span>
                <span className="users-actions" data-label="Actions">
                  <button className="btn btn-sm" onClick={() => setModal(user)}>Edit</button>
                  <button className="btn btn-sm btn-danger-ghost" onClick={() => setDeleteTarget(user)}>Delete</button>
                </span>
              </div>
            );
          })}
          <Pagination page={page} pageSize={pageSize} total={rows.length} onChange={setPage} />
        </>
      )}
    </div>
    {modal && <AdminFormModal type="user" item={modal._id ? modal : null} onClose={() => setModal(null)} onSaved={save} />}
    {deleteTarget && <div className="modal-backdrop"><div className="modal-dialog confirm-dialog" role="dialog" aria-modal="true"><div className="modal-heading"><p className="eyebrow">Destructive action</p><h2>Delete user?</h2><p className="sub">This permanently removes <b>{deleteTarget.name || deleteTarget.email}</b>.</p></div><div className="modal-actions"><button className="btn" onClick={() => setDeleteTarget(null)} disabled={busy}>Cancel</button><button className="btn danger" onClick={remove} disabled={busy}>{busy ? 'Deleting…' : 'Delete permanently'}</button></div></div></div>}
  </>;
}
