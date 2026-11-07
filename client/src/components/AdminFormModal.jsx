import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

export default function AdminFormModal({ type, item, onClose, onSaved }) {
  const { meta } = useAuth();
  const isBranch = type === 'branch';
  const [form, setForm] = useState(isBranch ? {
    name: item?.name || '', prefix: item?.prefix || '', cluster: item?.cluster?._id || '',
  } : {
    name: item?.name || '', email: item?.email || '', password: '', role: item?.role || 'operator', branch: item?.branch?._id || '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const title = `${item ? 'Edit' : 'Add'} ${isBranch ? 'branch' : 'user'}`;

  useEffect(() => {
    if (form.role === 'superadmin' && form.branch) setForm((current) => ({ ...current, branch: '' }));
  }, [form.role, form.branch]);

  const submit = async (event) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const saved = await api(isBranch ? `/admin/branches${item ? `/${item._id}` : ''}` : `/admin/users${item ? `/${item._id}` : ''}`, {
        method: item ? 'PUT' : 'POST', body: form,
      });
      onSaved(saved);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return <div className="modal-backdrop"><div className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-form-title">
    <div className="modal-heading"><p className="eyebrow">Administration</p><h2 id="admin-form-title">{title}</h2><p className="sub">Enter the details below.</p></div>
    <form onSubmit={submit}>
      <div className="form-grid">
        <div><label htmlFor="admin-name">Name</label><input id="admin-name" required value={form.name} onChange={set('name')} /></div>
        {isBranch ? <><div><label htmlFor="admin-prefix">Prefix</label><input id="admin-prefix" required maxLength="10" value={form.prefix} onChange={set('prefix')} /></div><div><label htmlFor="admin-cluster">Cluster</label><select id="admin-cluster" required value={form.cluster} onChange={set('cluster')}><option value="">Select cluster</option>{meta.clusters.map((cluster) => <option key={cluster._id} value={cluster._id}>{cluster.name}</option>)}</select></div></> : <>
          <div><label htmlFor="admin-email">Email</label><input id="admin-email" type="email" required value={form.email} onChange={set('email')} /></div>
          <div><label htmlFor="admin-role">Role</label><select id="admin-role" value={form.role} onChange={set('role')}><option value="operator">Operator</option><option value="superadmin">Super admin</option></select></div>
          <div><label htmlFor="admin-branch">Branch</label><select id="admin-branch" required={form.role === 'operator'} disabled={form.role === 'superadmin'} value={form.branch} onChange={set('branch')}><option value="">Select branch</option>{meta.branches.map((branch) => <option key={branch._id} value={branch._id}>{branch.name} ({branch.prefix})</option>)}</select></div>
          <div><label htmlFor="admin-password">Password{item && ' (leave blank to keep current)'}</label><input id="admin-password" type="password" required={!item} minLength="8" value={form.password} onChange={set('password')} /></div>
        </>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button className="btn" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="btn blue" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
    </form>
  </div></div>;
}
