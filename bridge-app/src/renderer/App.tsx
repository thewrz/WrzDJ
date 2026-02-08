import { useState, useCallback } from 'react';
import { useAuth } from './hooks/useAuth.js';
import { useBridgeStatus } from './hooks/useBridgeStatus.js';
import { LoginForm } from './components/LoginForm.js';
import { EventSelector } from './components/EventSelector.js';
import { BridgeControls } from './components/BridgeControls.js';
import { StatusPanel } from './components/StatusPanel.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import type { EventInfo } from '../shared/types.js';

export function App() {
  const { authState, loading, error, login, logout } = useAuth();
  const bridgeStatus = useBridgeStatus();
  const [selectedEvent, setSelectedEvent] = useState<EventInfo | null>(null);

  const handleEventSelect = useCallback((event: EventInfo) => {
    setSelectedEvent(event);
  }, []);

  // Loading state
  if (loading && !authState.isAuthenticated) {
    return <div className="loading">Loading...</div>;
  }

  // Not authenticated - show login
  if (!authState.isAuthenticated) {
    return <LoginForm onLogin={login} error={error} loading={loading} />;
  }

  // Authenticated - show main UI
  return (
    <div className="app">
      <div className="app-header">
        <h1>WrzDJ Bridge</h1>
        <div className="app-header-user">
          <span>{authState.username}</span>
          <button className="btn btn-ghost btn-sm" onClick={logout}>
            Sign Out
          </button>
        </div>
      </div>

      <div className="app-content">
        <EventSelector
          selectedCode={selectedEvent?.code ?? null}
          onSelect={handleEventSelect}
        />

        <BridgeControls
          status={bridgeStatus}
          selectedEventCode={selectedEvent?.code ?? null}
        />

        <StatusPanel status={bridgeStatus} />

        <SettingsPanel />
      </div>
    </div>
  );
}
