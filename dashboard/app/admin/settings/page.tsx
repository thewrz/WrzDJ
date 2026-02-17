'use client';

import { useEffect, useState } from 'react';
import { api, SystemSettings } from '@/lib/api';
import { useHelp } from '@/lib/help/HelpContext';
import { HelpSpot } from '@/components/help/HelpSpot';
import { HelpButton } from '@/components/help/HelpButton';
import { OnboardingOverlay } from '@/components/help/OnboardingOverlay';

const PAGE_ID = 'admin-settings';

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { hasSeenPage, startOnboarding, onboardingActive } = useHelp();

  useEffect(() => {
    api.getAdminSettings()
      .then(setSettings)
      .catch(() => setError('Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (settings && !onboardingActive && !hasSeenPage(PAGE_ID)) {
      const timer = setTimeout(() => startOnboarding(PAGE_ID), 500);
      return () => clearTimeout(timer);
    }
  }, [settings, onboardingActive, hasSeenPage, startOnboarding]);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const updated = await api.updateAdminSettings(settings);
      setSettings(updated);
      setSuccess('Settings saved');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading settings...</div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="container">
        <div className="card" style={{ color: '#ef4444' }}>{error || 'Failed to load'}</div>
      </div>
    );
  }

  return (
    <div className="container">
      <HelpButton page={PAGE_ID} />
      <OnboardingOverlay page={PAGE_ID} />
      <h1 style={{ marginBottom: '2rem' }}>System Settings</h1>

      {error && (
        <div style={{ color: '#ef4444', marginBottom: '1rem' }}>{error}</div>
      )}
      {success && (
        <div style={{ color: '#22c55e', marginBottom: '1rem' }}>{success}</div>
      )}

      <div className="card">
        <HelpSpot spotId="admin-registration" page={PAGE_ID} order={1} title="Self-Registration" description="Allow public sign-ups. New users start as &quot;pending&quot; until approved.">
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.registration_enabled}
                onChange={(e) => setSettings({ ...settings, registration_enabled: e.target.checked })}
                style={{ width: '1.25rem', height: '1.25rem' }}
              />
              <div>
                <div style={{ fontWeight: 500 }}>Self-Registration</div>
                <div style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
                  Allow new users to register. They start as &quot;pending&quot; until approved.
                </div>
              </div>
            </label>
          </div>
        </HelpSpot>

        <HelpSpot spotId="admin-rate-limit" page={PAGE_ID} order={2} title="Search Rate Limit" description="Throttle music search queries per IP to prevent API abuse.">
          <div className="form-group" style={{ marginTop: '1.5rem' }}>
            <label htmlFor="rate-limit">Search Rate Limit (per minute per IP)</label>
            <div style={{ color: '#9ca3af', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
              Controls how many Spotify/Tidal search queries each IP can make per minute.
            </div>
            <input
              id="rate-limit"
              type="number"
              className="input"
              style={{ maxWidth: '200px' }}
              min={1}
              max={100}
              value={settings.search_rate_limit_per_minute}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  search_rate_limit_per_minute: parseInt(e.target.value) || 1,
                })
              }
            />
          </div>
        </HelpSpot>

        <HelpSpot spotId="admin-save-settings" page={PAGE_ID} order={3} title="Save" description="Settings are stored in the database and take effect immediately.">
          <button
            className="btn btn-primary"
            style={{ marginTop: '1.5rem' }}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </HelpSpot>
      </div>
    </div>
  );
}
