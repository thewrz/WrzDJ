import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import type { BridgeSettings } from '../../shared/types.js';
import { DEFAULT_SETTINGS, AVAILABLE_PLUGINS } from '../../shared/types.js';
import { useBridgeStatus } from '../hooks/useBridgeStatus.js';

/** Check if the selected protocol supports a capability */
function pluginHasCapability(protocol: string, capability: 'faderLevel' | 'masterDeck'): boolean {
  // StageLinQ supports all capabilities; other plugins may not
  if (protocol === 'stagelinq') return true;
  if (protocol === 'traktor-broadcast') return false;
  return true; // Unknown plugins — show all options
}

export function SettingsPanel() {
  const [settings, setSettings] = useState<BridgeSettings>(DEFAULT_SETTINGS);
  const [open, setOpen] = useState(false);
  const bridgeStatus = useBridgeStatus();

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, []);

  const update = useCallback(async (partial: Partial<BridgeSettings>) => {
    try {
      const updated = await api.updateSettings(partial);
      setSettings(updated);
    } catch {
      // Silently fail - settings will be stale but functional
    }
  }, []);

  const protocol = settings.protocol || 'stagelinq';
  const isTraktor = protocol === 'traktor-broadcast';

  return (
    <div className="card">
      <div
        className="card-title"
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
        onClick={() => setOpen(!open)}
      >
        Detection Settings
        <span style={{ fontSize: '0.75rem' }}>{open ? '▼' : '▶'}</span>
      </div>

      {open && (
        <div>
          <div className="settings-row">
            <label>Protocol</label>
            <select
              value={protocol}
              disabled={bridgeStatus.isRunning}
              onChange={(e) => update({ protocol: e.target.value })}
              style={{
                background: '#2a2a2a',
                color: '#ededed',
                border: '1px solid #444',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '0.85rem',
              }}
            >
              {AVAILABLE_PLUGINS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {bridgeStatus.isRunning && (
            <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '8px', paddingLeft: '4px' }}>
              Stop the bridge to change protocol.
            </div>
          )}

          {isTraktor && (
            <div className="settings-row">
              <label>Broadcast port</label>
              <input
                type="number"
                value={(settings.pluginConfig?.port as number) ?? 8123}
                min={1024}
                max={65535}
                disabled={bridgeStatus.isRunning}
                onChange={(e) => update({
                  pluginConfig: {
                    ...settings.pluginConfig,
                    port: parseInt(e.target.value) || 8123,
                  },
                })}
              />
            </div>
          )}

          <div className="settings-row">
            <label>Live threshold (seconds)</label>
            <input
              type="number"
              value={settings.liveThresholdSeconds}
              min={1}
              max={60}
              onChange={(e) => update({ liveThresholdSeconds: parseInt(e.target.value) || 15 })}
            />
          </div>

          <div className="settings-row">
            <label>Pause grace (seconds)</label>
            <input
              type="number"
              value={settings.pauseGraceSeconds}
              min={1}
              max={30}
              onChange={(e) => update({ pauseGraceSeconds: parseInt(e.target.value) || 3 })}
            />
          </div>

          <div className="settings-row">
            <label>Now-playing pause (seconds)</label>
            <input
              type="number"
              value={settings.nowPlayingPauseSeconds}
              min={1}
              max={60}
              onChange={(e) => update({ nowPlayingPauseSeconds: parseInt(e.target.value) || 10 })}
            />
          </div>

          <div className="settings-row">
            <label>Min play (seconds)</label>
            <input
              type="number"
              value={settings.minPlaySeconds}
              min={1}
              max={30}
              onChange={(e) => update({ minPlaySeconds: parseInt(e.target.value) || 5 })}
            />
          </div>

          {pluginHasCapability(protocol, 'faderLevel') && (
            <div className="settings-row">
              <label>Require fader up</label>
              <button
                className={`toggle ${settings.useFaderDetection ? 'active' : ''}`}
                onClick={() => update({ useFaderDetection: !settings.useFaderDetection })}
              />
            </div>
          )}

          {pluginHasCapability(protocol, 'masterDeck') && (
            <div className="settings-row">
              <label>Master deck only</label>
              <button
                className={`toggle ${settings.masterDeckPriority ? 'active' : ''}`}
                onClick={() => update({ masterDeckPriority: !settings.masterDeckPriority })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
