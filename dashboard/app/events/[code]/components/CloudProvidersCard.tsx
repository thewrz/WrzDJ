'use client';

import { TidalStatus } from '@/lib/api';

interface CloudProvidersCardProps {
  tidalStatus: TidalStatus | null;
  tidalSyncEnabled: boolean;
  togglingTidalSync: boolean;
  onToggleTidalSync: () => void;
  onConnectTidal: () => void;
  onDisconnectTidal: () => void;
}

const PLACEHOLDER_PROVIDERS = [
  { name: 'Beatport', color: '#01ff28' },
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
          <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>Playlist Sync for SC6000</span>
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
