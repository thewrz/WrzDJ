'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  IntegrationServiceStatus,
  CapabilityStatus,
} from '@/lib/api';
import { api } from '@/lib/api';

const BADGE_LABELS: Record<CapabilityStatus, string> = {
  yes: 'YES',
  no: 'NO',
  not_implemented: 'N/A',
  configured: 'CONFIGURED',
  not_configured: 'NOT CONFIGURED',
};

const BADGE_CLASSES: Record<CapabilityStatus, string> = {
  yes: 'badge-status yes',
  no: 'badge-status no',
  not_implemented: 'badge-status not-implemented',
  configured: 'badge-status configured',
  not_configured: 'badge-status not-configured',
};

function CapabilityBadge({ status }: { status: CapabilityStatus }) {
  return <span className={BADGE_CLASSES[status]}>{BADGE_LABELS[status]}</span>;
}

export default function AdminIntegrationsPage() {
  const [services, setServices] = useState<IntegrationServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [toggling, setToggling] = useState<Record<string, boolean>>({});

  const loadIntegrations = useCallback(async () => {
    try {
      const data = await api.getIntegrations();
      setServices(data.services);
      setError('');
    } catch {
      setError('Failed to load integration status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIntegrations();
  }, [loadIntegrations]);

  const handleToggle = async (service: string, currentEnabled: boolean) => {
    setToggling((prev) => ({ ...prev, [service]: true }));
    try {
      const result = await api.toggleIntegration(service, !currentEnabled);
      setServices((prev) =>
        prev.map((s) =>
          s.service === service ? { ...s, enabled: result.enabled } : s
        )
      );
    } catch {
      setError(`Failed to toggle ${service}`);
    } finally {
      setToggling((prev) => ({ ...prev, [service]: false }));
    }
  };

  const handleCheck = async (service: string) => {
    setChecking((prev) => ({ ...prev, [service]: true }));
    try {
      const result = await api.checkIntegrationHealth(service);
      setServices((prev) =>
        prev.map((s) =>
          s.service === service
            ? {
                ...s,
                capabilities: result.capabilities,
                last_check_error: result.error,
              }
            : s
        )
      );
    } catch {
      setError(`Health check failed for ${service}`);
    } finally {
      setChecking((prev) => ({ ...prev, [service]: false }));
    }
  };

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading integrations...</div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1 style={{ marginBottom: '0.5rem' }}>Integrations</h1>
      <p style={{ color: '#9ca3af', marginBottom: '2rem' }}>
        Monitor and control external service integrations. Disabled services
        show &quot;currently unavailable&quot; to DJs.
      </p>

      {error && (
        <div
          style={{
            color: '#ef4444',
            marginBottom: '1rem',
            padding: '0.75rem',
            background: 'rgba(239, 68, 68, 0.1)',
            borderRadius: '6px',
          }}
        >
          {error}
        </div>
      )}

      <div className="card" style={{ overflow: 'auto' }}>
        <table className="integration-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Enabled</th>
              <th>Auth / Login</th>
              <th>Catalog Search</th>
              <th>Playlist Sync</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {services.map((svc) => (
              <tr key={svc.service}>
                <td>
                  <div style={{ fontWeight: 500 }}>{svc.display_name}</div>
                  {svc.last_check_error && (
                    <div
                      style={{
                        color: '#ef4444',
                        fontSize: '0.75rem',
                        marginTop: '0.25rem',
                      }}
                    >
                      {svc.last_check_error}
                    </div>
                  )}
                </td>
                <td>
                  <button
                    className={`toggle-switch${svc.enabled ? ' active' : ''}`}
                    onClick={() => handleToggle(svc.service, svc.enabled)}
                    disabled={toggling[svc.service]}
                    aria-label={`${svc.enabled ? 'Disable' : 'Enable'} ${svc.display_name}`}
                  />
                </td>
                <td>
                  <CapabilityBadge status={svc.capabilities.auth} />
                </td>
                <td>
                  <CapabilityBadge status={svc.capabilities.catalog_search} />
                </td>
                <td>
                  <CapabilityBadge status={svc.capabilities.playlist_sync} />
                </td>
                <td>
                  <button
                    className="btn-check"
                    onClick={() => handleCheck(svc.service)}
                    disabled={checking[svc.service]}
                  >
                    {checking[svc.service] ? 'Checking...' : 'Check Health'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        className="card"
        style={{ marginTop: '1rem', color: '#9ca3af', fontSize: '0.875rem' }}
      >
        <strong style={{ color: '#ededed' }}>Badge Legend</strong>
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            flexWrap: 'wrap',
            marginTop: '0.75rem',
          }}
        >
          <span>
            <span className="badge-status yes">YES</span> Working
          </span>
          <span>
            <span className="badge-status configured">CONFIGURED</span>{' '}
            Credentials set, untested
          </span>
          <span>
            <span className="badge-status no">NO</span> Check failed
          </span>
          <span>
            <span className="badge-status not-configured">NOT CONFIGURED</span>{' '}
            No credentials
          </span>
          <span>
            <span className="badge-status not-implemented">N/A</span> Not
            supported
          </span>
        </div>
      </div>
    </div>
  );
}
