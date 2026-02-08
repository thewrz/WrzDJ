'use client';

import { useEffect, useState } from 'react';
import { api, AdminUser } from '@/lib/api';

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [roleFilter, setRoleFilter] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [formData, setFormData] = useState({ username: '', password: '', role: 'dj' });
  const [editData, setEditData] = useState({ role: '', is_active: true, password: '' });
  const [error, setError] = useState('');
  const limit = 20;

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await api.getAdminUsers(page, limit, roleFilter);
      setUsers(data.items);
      setTotal(data.total);
    } catch {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [page, roleFilter]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.createAdminUser(formData);
      setShowCreate(false);
      setFormData({ username: '', password: '', role: 'dj' });
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setError('');
    try {
      const update: Record<string, unknown> = {};
      if (editData.role !== editUser.role) update.role = editData.role;
      if (editData.is_active !== editUser.is_active) update.is_active = editData.is_active;
      if (editData.password) update.password = editData.password;
      await api.updateAdminUser(editUser.id, update);
      setEditUser(null);
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
    }
  };

  const handleDelete = async (user: AdminUser) => {
    if (!confirm(`Delete user "${user.username}"? This will also delete all their events.`)) return;
    try {
      await api.deleteAdminUser(user.id);
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  const openEdit = (user: AdminUser) => {
    setEditUser(user);
    setEditData({ role: user.role, is_active: user.is_active, password: '' });
    setError('');
  };

  const totalPages = Math.ceil(total / limit);

  const roleFilters = [
    { label: 'All', value: undefined },
    { label: 'Admins', value: 'admin' },
    { label: 'DJs', value: 'dj' },
    { label: 'Pending', value: 'pending' },
  ];

  return (
    <div className="container">
      <div className="header">
        <h1>User Management</h1>
        <button className="btn btn-primary" onClick={() => { setShowCreate(true); setError(''); }}>
          Create User
        </button>
      </div>

      {error && (
        <div style={{ color: '#ef4444', marginBottom: '1rem' }}>{error}</div>
      )}

      <div className="tabs" style={{ marginBottom: '1rem' }}>
        {roleFilters.map((f) => (
          <button
            key={f.label}
            className={`tab${roleFilter === f.value ? ' active' : ''}`}
            onClick={() => { setRoleFilter(f.value); setPage(1); }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: '1rem' }}>Create User</h2>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label htmlFor="new-username">Username</label>
                <input
                  id="new-username"
                  className="input"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  required
                  minLength={3}
                />
              </div>
              <div className="form-group">
                <label htmlFor="new-password">Password</label>
                <input
                  id="new-password"
                  type="password"
                  className="input"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                  minLength={8}
                />
              </div>
              <div className="form-group">
                <label htmlFor="new-role">Role</label>
                <select
                  id="new-role"
                  className="input"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                >
                  <option value="dj">DJ</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="submit" className="btn btn-primary">Create</button>
                <button type="button" className="btn" style={{ background: '#333' }} onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editUser && (
        <div className="modal-overlay" onClick={() => setEditUser(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: '1rem' }}>Edit: {editUser.username}</h2>
            <form onSubmit={handleEdit}>
              <div className="form-group">
                <label htmlFor="edit-role">Role</label>
                <select
                  id="edit-role"
                  className="input"
                  value={editData.role}
                  onChange={(e) => setEditData({ ...editData, role: e.target.value })}
                >
                  <option value="admin">Admin</option>
                  <option value="dj">DJ</option>
                  <option value="pending">Pending</option>
                </select>
              </div>
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={editData.is_active}
                    onChange={(e) => setEditData({ ...editData, is_active: e.target.checked })}
                  />{' '}
                  Active
                </label>
              </div>
              <div className="form-group">
                <label htmlFor="edit-password">New Password (leave blank to keep)</label>
                <input
                  id="edit-password"
                  type="password"
                  className="input"
                  value={editData.password}
                  onChange={(e) => setEditData({ ...editData, password: e.target.value })}
                  minLength={8}
                />
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="submit" className="btn btn-primary">Save</button>
                <button type="button" className="btn" style={{ background: '#333' }} onClick={() => setEditUser(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading">Loading users...</div>
      ) : (
        <>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Status</th>
                <th>Events</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>
                    <span className={`badge badge-role-${user.role}`}>
                      {user.role}
                    </span>
                  </td>
                  <td>{user.is_active ? 'Active' : 'Inactive'}</td>
                  <td>{user.event_count}</td>
                  <td>{new Date(user.created_at).toLocaleDateString()}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button className="btn btn-sm btn-primary" onClick={() => openEdit(user)}>
                        Edit
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(user)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="btn btn-sm"
                style={{ background: '#333' }}
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <span style={{ color: '#9ca3af' }}>
                Page {page} of {totalPages}
              </span>
              <button
                className="btn btn-sm"
                style={{ background: '#333' }}
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
