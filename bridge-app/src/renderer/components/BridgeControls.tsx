import { useState } from 'react';
import { api } from '../api.js';
import type { BridgeStatus } from '../../shared/types.js';

interface BridgeControlsProps {
  status: BridgeStatus;
  selectedEventCode: string | null;
}

export function BridgeControls({ status, selectedEventCode }: BridgeControlsProps) {
  const [apiKey, setApiKey] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    if (!selectedEventCode || !apiKey) return;

    setStarting(true);
    setError(null);
    try {
      await api.startBridge(selectedEventCode, apiKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start bridge');
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    try {
      await api.stopBridge();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop bridge');
    }
  };

  return (
    <div className="card">
      <div className="card-title">Bridge Controls</div>

      {error && <div className="error-message">{error}</div>}

      {!status.isRunning ? (
        <>
          <div className="bridge-controls">
            <div className="form-group">
              <label htmlFor="apiKey">Bridge API Key</label>
              <input
                id="apiKey"
                className="input"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste your bridge API key"
              />
            </div>
            <button
              className="btn btn-success"
              onClick={handleStart}
              disabled={starting || !selectedEventCode || !apiKey}
            >
              {starting ? 'Starting...' : 'Start Bridge'}
            </button>
          </div>
          {!selectedEventCode && (
            <p style={{ color: '#f59e0b', fontSize: '0.8rem', marginTop: '0.5rem' }}>
              Select an event above to start the bridge.
            </p>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="status-dot status-dot-green" />
            <span>Running for event <strong>{status.eventCode}</strong></span>
          </div>
          <button className="btn btn-danger btn-sm" onClick={handleStop}>
            Stop Bridge
          </button>
        </div>
      )}
    </div>
  );
}
