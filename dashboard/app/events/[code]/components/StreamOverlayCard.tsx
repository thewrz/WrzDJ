'use client';

import { useState } from 'react';

interface StreamOverlayCardProps {
  code: string;
}

export function StreamOverlayCard({ code }: StreamOverlayCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const overlayUrl = `${window.location.origin}/e/${code}/overlay`;
    navigator.clipboard.writeText(overlayUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="card" style={{ marginBottom: '1rem', padding: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontWeight: 600 }}>Stream Overlay</span>
          <p style={{ color: '#b0b0b0', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
            OBS browser source for streaming the now-playing track
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <a
            href={`/e/${code}/overlay`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-sm"
            style={{ background: '#333', textDecoration: 'none', color: '#ededed' }}
          >
            Stream Overlay
          </a>
          <button
            className="btn btn-sm"
            style={{
              background: copied ? '#22c55e' : '#333',
              transition: 'background 0.2s',
            }}
            onClick={handleCopy}
            title="Copy overlay URL for OBS"
          >
            {copied ? 'Copied!' : 'Copy URL'}
          </button>
        </div>
      </div>
    </div>
  );
}
