import { useState, useEffect, useRef } from 'react';
import type { LogEntry } from '../hooks/useBridgeLog.js';

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

export function LogPanel({ entries, onClear }: LogPanelProps) {
  const [open, setOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

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
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem', gap: '0.5rem' }}>
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
              entries.map((entry) => (
                <div key={entry.id} className="log-entry">
                  <span className="log-timestamp">{formatTime(entry.timestamp)}</span>
                  <span className="log-message">{entry.message}</span>
                </div>
              ))
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
