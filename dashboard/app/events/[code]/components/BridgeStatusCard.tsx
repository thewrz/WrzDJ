'use client';

interface BridgeStatusCardProps {
  bridgeConnected: boolean;
}

export function BridgeStatusCard({ bridgeConnected }: BridgeStatusCardProps) {
  return (
    <div
      className="card"
      style={{
        marginBottom: '1rem',
        padding: '1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <div>
        <span style={{ fontWeight: 600 }}>Bridge Status</span>
        <p style={{ color: '#b0b0b0', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
          Live track detection for compatible controllers and software
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: bridgeConnected ? '#10b981' : '#6b7280',
            display: 'inline-block',
          }}
        />
        <span style={{ color: bridgeConnected ? '#10b981' : '#9ca3af', fontSize: '0.875rem' }}>
          {bridgeConnected ? 'Bridge Connected' : 'Bridge Not Connected'}
        </span>
      </div>
    </div>
  );
}
