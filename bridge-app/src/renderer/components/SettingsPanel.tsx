import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import type { BridgeSettings } from '../../shared/types.js';
import { DEFAULT_SETTINGS } from '../../shared/types.js';

export function SettingsPanel() {
  const [settings, setSettings] = useState<BridgeSettings>(DEFAULT_SETTINGS);
  const [open, setOpen] = useState(false);

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

          <div className="settings-row">
            <label>Require fader up</label>
            <button
              className={`toggle ${settings.useFaderDetection ? 'active' : ''}`}
              onClick={() => update({ useFaderDetection: !settings.useFaderDetection })}
            />
          </div>

          <div className="settings-row">
            <label>Master deck only</label>
            <button
              className={`toggle ${settings.masterDeckPriority ? 'active' : ''}`}
              onClick={() => update({ masterDeckPriority: !settings.masterDeckPriority })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
