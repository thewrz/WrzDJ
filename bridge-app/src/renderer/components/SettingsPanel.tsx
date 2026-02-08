import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import type { BridgeSettings, PluginMeta, PluginConfigOption } from '../../shared/types.js';
import { DEFAULT_SETTINGS } from '../../shared/types.js';
import { useBridgeStatus } from '../hooks/useBridgeStatus.js';

export function SettingsPanel() {
  const [settings, setSettings] = useState<BridgeSettings>(DEFAULT_SETTINGS);
  const [plugins, setPlugins] = useState<readonly PluginMeta[]>([]);
  const [open, setOpen] = useState(false);
  const bridgeStatus = useBridgeStatus();

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
    api.listPluginMeta().then(setPlugins).catch(() => {});
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
  const currentPlugin = plugins.find((p) => p.info.id === protocol);

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
              {plugins.map((p) => (
                <option key={p.info.id} value={p.info.id}>{p.info.name}</option>
              ))}
            </select>
          </div>

          {bridgeStatus.isRunning && (
            <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '8px', paddingLeft: '4px' }}>
              Stop the bridge to change protocol.
            </div>
          )}

          {currentPlugin && currentPlugin.configOptions.length > 0 && (
            currentPlugin.configOptions.map((opt) => (
              <PluginConfigInput
                key={opt.key}
                option={opt}
                value={settings.pluginConfig?.[opt.key]}
                disabled={bridgeStatus.isRunning}
                onChange={(value) => update({
                  pluginConfig: { ...settings.pluginConfig, [opt.key]: value },
                })}
              />
            ))
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

          {currentPlugin?.capabilities.faderLevel && (
            <div className="settings-row">
              <label>Require fader up</label>
              <button
                className={`toggle ${settings.useFaderDetection ? 'active' : ''}`}
                onClick={() => update({ useFaderDetection: !settings.useFaderDetection })}
              />
            </div>
          )}

          {currentPlugin?.capabilities.masterDeck && (
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

/** Renders a single plugin config option as the appropriate input type. */
function PluginConfigInput({ option, value, disabled, onChange }: {
  option: PluginConfigOption;
  value: unknown;
  disabled: boolean;
  onChange: (value: number | string | boolean) => void;
}) {
  if (option.type === 'number') {
    return (
      <div className="settings-row">
        <label>{option.label}</label>
        <input
          type="number"
          value={(value as number) ?? option.default}
          min={option.min}
          max={option.max}
          disabled={disabled}
          onChange={(e) => onChange(parseInt(e.target.value) || (option.default as number))}
        />
      </div>
    );
  }

  if (option.type === 'string') {
    return (
      <div className="settings-row">
        <label>{option.label}</label>
        <input
          type="text"
          value={(value as string) ?? option.default}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (option.type === 'boolean') {
    const checked = (value as boolean) ?? option.default;
    return (
      <div className="settings-row">
        <label>{option.label}</label>
        <button
          className={`toggle ${checked ? 'active' : ''}`}
          disabled={disabled}
          onClick={() => onChange(!checked)}
        />
      </div>
    );
  }

  return null;
}
