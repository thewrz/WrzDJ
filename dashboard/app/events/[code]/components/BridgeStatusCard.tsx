'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

interface BridgeDetails {
  circuitBreakerState: string | null;
  bufferSize: number | null;
  pluginId: string | null;
  deckCount: number | null;
  uptimeSeconds: number | null;
}

interface BridgeStatusCardProps {
  eventCode: string;
  bridgeConnected: boolean;
  bridgeDetails?: BridgeDetails | null;
}

function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function circuitBreakerColor(state: string | null): string {
  if (!state) return '#6b7280';
  switch (state.toUpperCase()) {
    case 'CLOSED':
      return '#10b981';
    case 'OPEN':
      return '#ef4444';
    case 'HALF_OPEN':
      return '#f59e0b';
    default:
      return '#6b7280';
  }
}

type CommandType = 'reset_decks' | 'reconnect' | 'restart';

export function BridgeStatusCard({ eventCode, bridgeConnected, bridgeDetails }: BridgeStatusCardProps) {
  const [loadingCommand, setLoadingCommand] = useState<CommandType | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);

  // Auto-clear loading state after 10s (fire-and-forget)
  useEffect(() => {
    if (!loadingCommand) return;
    const timer = setTimeout(() => setLoadingCommand(null), 10_000);
    return () => clearTimeout(timer);
  }, [loadingCommand]);

  // Auto-clear error after 5s
  useEffect(() => {
    if (!commandError) return;
    const timer = setTimeout(() => setCommandError(null), 5000);
    return () => clearTimeout(timer);
  }, [commandError]);

  const sendCommand = useCallback(async (command: CommandType) => {
    setLoadingCommand(command);
    setCommandError(null);
    try {
      await api.sendBridgeCommand(eventCode, command);
    } catch (err) {
      setCommandError(err instanceof Error ? err.message : 'Command failed');
      setLoadingCommand(null);
    }
  }, [eventCode]);

  const handleRestart = useCallback(() => {
    setShowRestartConfirm(false);
    sendCommand('restart');
  }, [sendCommand]);

  const buttonStyle = (disabled: boolean): React.CSSProperties => ({
    background: 'transparent',
    border: `1px solid ${disabled ? '#333' : '#555'}`,
    color: disabled ? '#555' : '#9ca3af',
    padding: '0.25rem 0.625rem',
    borderRadius: '0.25rem',
    fontSize: '0.75rem',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.375rem',
    whiteSpace: 'nowrap' as const,
  });

  const detailLabelStyle: React.CSSProperties = {
    color: '#6b7280',
    fontSize: '0.75rem',
  };

  const detailValueStyle: React.CSSProperties = {
    color: '#9ca3af',
    fontSize: '0.75rem',
    fontWeight: 500,
  };

  const hasDetails = bridgeConnected && bridgeDetails;

  return (
    <div className="card" style={{ marginBottom: '1rem', padding: '1rem' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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

      {/* Enriched details grid */}
      {hasDetails && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
            gap: '0.5rem 1rem',
            marginTop: '0.75rem',
            paddingTop: '0.625rem',
            borderTop: '1px solid #2a2a2a',
          }}
        >
          {bridgeDetails.pluginId && (
            <div>
              <div style={detailLabelStyle}>Plugin</div>
              <div style={detailValueStyle}>{bridgeDetails.pluginId}</div>
            </div>
          )}
          {bridgeDetails.circuitBreakerState && (
            <div>
              <div style={detailLabelStyle}>Circuit Breaker</div>
              <div style={{ ...detailValueStyle, color: circuitBreakerColor(bridgeDetails.circuitBreakerState) }}>
                {bridgeDetails.circuitBreakerState}
              </div>
            </div>
          )}
          {bridgeDetails.bufferSize !== null && (
            <div>
              <div style={detailLabelStyle}>Buffer</div>
              <div style={detailValueStyle}>{bridgeDetails.bufferSize} tracks</div>
            </div>
          )}
          {bridgeDetails.deckCount !== null && (
            <div>
              <div style={detailLabelStyle}>Decks</div>
              <div style={detailValueStyle}>{bridgeDetails.deckCount}</div>
            </div>
          )}
          {bridgeDetails.uptimeSeconds !== null && (
            <div>
              <div style={detailLabelStyle}>Uptime</div>
              <div style={detailValueStyle}>{formatUptime(bridgeDetails.uptimeSeconds)}</div>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginTop: '0.75rem',
          paddingTop: '0.625rem',
          borderTop: '1px solid #2a2a2a',
          flexWrap: 'wrap',
        }}
      >
        <button
          style={buttonStyle(!bridgeConnected || loadingCommand !== null)}
          disabled={!bridgeConnected || loadingCommand !== null}
          onClick={() => sendCommand('reset_decks')}
          title="Clears stale deck state"
        >
          {loadingCommand === 'reset_decks' && <Spinner />}
          Reset Decks
        </button>
        <button
          style={buttonStyle(!bridgeConnected || loadingCommand !== null)}
          disabled={!bridgeConnected || loadingCommand !== null}
          onClick={() => sendCommand('reconnect')}
          title="Re-establishes equipment connection"
        >
          {loadingCommand === 'reconnect' && <Spinner />}
          Reconnect
        </button>
        <button
          style={buttonStyle(!bridgeConnected || loadingCommand !== null)}
          disabled={!bridgeConnected || loadingCommand !== null}
          onClick={() => setShowRestartConfirm(true)}
          title="Full stop and restart"
        >
          {loadingCommand === 'restart' && <Spinner />}
          Restart
        </button>

        {commandError && (
          <span style={{ color: '#ef4444', fontSize: '0.75rem', marginLeft: '0.25rem' }}>
            {commandError}
          </span>
        )}
      </div>

      {/* Restart confirmation dialog */}
      {showRestartConfirm && (
        <div
          style={{
            marginTop: '0.5rem',
            padding: '0.625rem 0.75rem',
            background: '#1f1f1f',
            borderRadius: '0.375rem',
            border: '1px solid #333',
            fontSize: '0.8125rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ color: '#f59e0b' }}>
            This will briefly disconnect from your equipment. Continue?
          </span>
          <div style={{ display: 'flex', gap: '0.375rem' }}>
            <button
              style={{
                background: '#ef4444',
                color: '#fff',
                border: 'none',
                padding: '0.25rem 0.625rem',
                borderRadius: '0.25rem',
                fontSize: '0.75rem',
                cursor: 'pointer',
              }}
              onClick={handleRestart}
            >
              Restart
            </button>
            <button
              style={{
                background: '#333',
                color: '#9ca3af',
                border: 'none',
                padding: '0.25rem 0.625rem',
                borderRadius: '0.25rem',
                fontSize: '0.75rem',
                cursor: 'pointer',
              }}
              onClick={() => setShowRestartConfirm(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: '10px',
        height: '10px',
        border: '1.5px solid #555',
        borderTopColor: '#9ca3af',
        borderRadius: '50%',
        animation: 'spin 0.6s linear infinite',
      }}
    />
  );
}
