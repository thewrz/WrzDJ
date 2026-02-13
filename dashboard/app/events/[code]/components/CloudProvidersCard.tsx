'use client';

import type { BeatportStatus, TidalStatus } from '@/lib/api';

interface CloudProvidersCardProps {
  tidalStatus: TidalStatus | null;
  tidalSyncEnabled: boolean;
  togglingTidalSync: boolean;
  onToggleTidalSync: () => void;
  onConnectTidal: () => void;
  onDisconnectTidal: () => void;
  beatportStatus: BeatportStatus | null;
  beatportSyncEnabled: boolean;
  togglingBeatportSync: boolean;
  onToggleBeatportSync: () => void;
  onConnectBeatport: () => void;
  onDisconnectBeatport: () => void;
}

const PLACEHOLDER_PROVIDERS = [
  { name: 'Beatsource', color: '#ff6b00' },
  { name: 'SoundCloud', color: '#ff5500' },
  { name: 'Amazon Music', color: '#25d1da' },
];

export function CloudProvidersCard({
  tidalStatus,
  tidalSyncEnabled,
  togglingTidalSync,
  onToggleTidalSync,
  onConnectTidal,
  onDisconnectTidal,
  beatportStatus,
  beatportSyncEnabled,
  togglingBeatportSync,
  onToggleBeatportSync,
  onConnectBeatport,
  onDisconnectBeatport,
}: CloudProvidersCardProps) {
  return (
    <div className="card" style={{ marginBottom: '1rem', padding: '1rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <span style={{ fontWeight: 600 }}>Cloud Providers</span>
        <p style={{ color: '#b0b0b0', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
          Sync accepted requests to streaming service playlists
        </p>
      </div>

      {/* Tidal - functional */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.75rem',
          background: '#111',
          borderRadius: '6px',
          marginBottom: '0.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Tidal</span>
          <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {tidalStatus?.linked ? (
            <>
              <span style={{ color: '#10b981', fontSize: '0.875rem' }}>Connected</span>
              <button
                className={`btn btn-sm ${tidalSyncEnabled ? 'btn-success' : ''}`}
                style={{ minWidth: '100px', background: tidalSyncEnabled ? undefined : '#333' }}
                onClick={onToggleTidalSync}
                disabled={togglingTidalSync}
              >
                {togglingTidalSync ? '...' : tidalSyncEnabled ? 'Enabled' : 'Disabled'}
              </button>
              <button
                className="btn btn-sm"
                style={{ background: '#666' }}
                onClick={onDisconnectTidal}
                title="Disconnect Tidal account"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              className="btn btn-sm"
              style={{ background: '#0066ff' }}
              onClick={onConnectTidal}
            >
              Connect Tidal
            </button>
          )}
        </div>
      </div>

      {/* Beatport - functional */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.75rem',
          background: '#111',
          borderRadius: '6px',
          marginBottom: '0.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Beatport</span>
          <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {beatportStatus?.linked ? (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                <span style={{ color: '#01ff28', fontSize: '0.875rem' }}>Connected</span>
                {beatportStatus.subscription && ['bp_link', 'bp_pro', 'streaming'].includes(beatportStatus.subscription) ? (
                  <span style={{ fontSize: '0.65rem', color: '#22c55e', background: '#052e16', padding: '0.125rem 0.375rem', borderRadius: '9999px' }}>
                    Full Streaming Access
                  </span>
                ) : (
                  <span style={{ fontSize: '0.65rem', color: '#f59e0b', background: '#451a03', padding: '0.125rem 0.375rem', borderRadius: '9999px' }}>
                    Purchased Library Only
                  </span>
                )}
              </div>
              <button
                className={`btn btn-sm ${beatportSyncEnabled ? 'btn-success' : ''}`}
                style={{ minWidth: '100px', background: beatportSyncEnabled ? undefined : '#333' }}
                onClick={onToggleBeatportSync}
                disabled={togglingBeatportSync}
              >
                {togglingBeatportSync ? '...' : beatportSyncEnabled ? 'Enabled' : 'Disabled'}
              </button>
              <button
                className="btn btn-sm"
                style={{ background: '#666' }}
                onClick={onDisconnectBeatport}
                title="Disconnect Beatport account"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              className="btn btn-sm"
              style={{ background: '#01ff28', color: '#000' }}
              onClick={onConnectBeatport}
            >
              Connect Beatport
            </button>
          )}
        </div>
      </div>

      {/* Placeholder providers */}
      {PLACEHOLDER_PROVIDERS.map((provider) => (
        <div
          key={provider.name}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.75rem',
            background: '#111',
            borderRadius: '6px',
            marginBottom: '0.5rem',
            opacity: 0.5,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{provider.name}</span>
          </div>
          <button
            className="btn btn-sm"
            style={{ background: '#333' }}
            disabled
          >
            Coming Soon
          </button>
        </div>
      ))}
    </div>
  );
}
