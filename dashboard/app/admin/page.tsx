'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, SystemStats } from '@/lib/api';

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getAdminStats()
      .then(setStats)
      .catch(() => setError('Failed to load stats'));
  }, []);

  if (error) {
    return (
      <div className="container">
        <div className="card" style={{ color: '#ef4444' }}>{error}</div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="container">
        <div className="loading">Loading stats...</div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1 style={{ marginBottom: '2rem' }}>Dashboard Overview</h1>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.total_users}</div>
          <div className="stat-label">Total Users</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.active_users}</div>
          <div className="stat-label">Active Users</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: stats.pending_users > 0 ? '#f59e0b' : undefined }}>
            {stats.pending_users}
          </div>
          <div className="stat-label">Pending Approval</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.total_events}</div>
          <div className="stat-label">Total Events</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.active_events}</div>
          <div className="stat-label">Active Events</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.total_requests}</div>
          <div className="stat-label">Total Requests</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
        <Link href="/admin/users">
          <button className="btn btn-primary">
            Manage Users
            {stats.pending_users > 0 && (
              <span className="badge" style={{ background: '#f59e0b', marginLeft: '0.5rem' }}>
                {stats.pending_users}
              </span>
            )}
          </button>
        </Link>
        <Link href="/admin/events">
          <button className="btn btn-primary">Manage Events</button>
        </Link>
      </div>
    </div>
  );
}
