import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api.js';
import type { LogEntry } from '../hooks/useBridgeLog.js';
import type { LogLevel } from '../../shared/types.js';

interface LogPanelProps {
  entries: readonly LogEntry[];
  onClear: () => void;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

const LEVEL_STYLES: Record<LogLevel, { color: string; label: string }> = {
  debug: { color: '#666', label: 'DBG' },
  info: { color: '#5b9bd5', label: 'INF' },
  warn: { color: '#e5a00d', label: 'WRN' },
  error: { color: '#e55', label: 'ERR' },
};

export function LogPanel({ entries, onClear }: LogPanelProps) {
  const [open, setOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const handleExportDebugReport = useCallback(async () => {
    try {
      const filePath = await api.exportDebugReport();
      if (filePath) {
        setExportStatus('Report saved');
        setTimeout(() => setExportStatus(null), 3000);
      }
    } catch {
      setExportStatus('Export failed');
      setTimeout(() => setExportStatus(null), 3000);
    }
  }, []);

  useEffect(() => {
    if (open && autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [entries, open, autoScroll]);

  const handleScroll = () => {
    if (!logRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isNearBottom);
  };

  return (
    <div className="card">
      <div
        className="card-title"
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        onClick={() => setOpen(!open)}
      >
        <span>
          Diagnostic Log
          {entries.length > 0 && (
            <span style={{ fontWeight: 400, fontSize: '0.7rem', marginLeft: '0.5rem', color: '#666' }}>
              ({entries.length})
            </span>
          )}
        </span>
        <span style={{ fontSize: '0.75rem' }}>{open ? '\u25BC' : '\u25B6'}</span>
      </div>

      {open && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '0.5rem', gap: '0.5rem' }}>
            {exportStatus && (
              <span style={{ fontSize: '0.7rem', color: '#5b9bd5' }}>{exportStatus}</span>
            )}
            <button
              className="btn btn-ghost btn-sm"
              onClick={(e) => { e.stopPropagation(); handleExportDebugReport(); }}
            >
              Export Report
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={(e) => { e.stopPropagation(); onClear(); }}
            >
              Clear
            </button>
          </div>

          <div
            ref={logRef}
            className="log-container"
            onScroll={handleScroll}
          >
            {entries.length === 0 ? (
              <div className="log-empty">No log entries yet. Start the bridge to see diagnostic output.</div>
            ) : (
              entries.map((entry) => {
                const levelStyle = LEVEL_STYLES[entry.level];
                return (
                  <div key={entry.id} className="log-entry">
                    <span className="log-timestamp">{formatTime(entry.timestamp)}</span>
                    <span className="log-level" style={{ color: levelStyle.color }}>{levelStyle.label}</span>
                    <span
                      className="log-message"
                      style={entry.level === 'error' ? { color: '#e55' } : entry.level === 'warn' ? { color: '#d4a' } : undefined}
                    >
                      {entry.message}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {!autoScroll && entries.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ width: '100%', marginTop: '0.25rem', fontSize: '0.7rem' }}
              onClick={() => {
                setAutoScroll(true);
                if (logRef.current) {
                  logRef.current.scrollTop = logRef.current.scrollHeight;
                }
              }}
            >
              Scroll to bottom
            </button>
          )}
        </div>
      )}
    </div>
  );
}
