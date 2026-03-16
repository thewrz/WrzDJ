'use client';

import { useEffect } from 'react';

interface CelebrationOverlayProps {
  song: { title: string; artist: string; artwork_url?: string | null } | null;
  onClose: () => void;
}

const AUTO_DISMISS_MS = 8000;
const CONFETTI_COUNT = 24;
const CONFETTI_COLORS = ['#22c55e', '#3b82f6', '#eab308', '#ef4444', '#a855f7', '#ec4899'];

export default function CelebrationOverlay({ song, onClose }: CelebrationOverlayProps) {
  useEffect(() => {
    if (!song) return;
    const timer = setTimeout(onClose, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [song, onClose]);

  if (!song) return null;

  return (
    <div className="celebration-overlay" onClick={onClose} role="dialog" aria-label="Your song is playing">
      {/* Confetti particles */}
      <div className="confetti-container" aria-hidden="true">
        {Array.from({ length: CONFETTI_COUNT }, (_, i) => (
          <div
            key={i}
            className="confetti-particle"
            style={{
              '--x': `${Math.random() * 100}vw`,
              '--delay': `${Math.random() * 2}s`,
              '--duration': `${2 + Math.random() * 3}s`,
              '--rotation': `${Math.random() * 720 - 360}deg`,
              backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
              width: `${6 + Math.random() * 6}px`,
              height: `${6 + Math.random() * 6}px`,
              borderRadius: Math.random() > 0.5 ? '50%' : '2px',
            } as React.CSSProperties}
          />
        ))}
      </div>

      <div className="celebration-content">
        {song.artwork_url && (
          <img
            src={song.artwork_url}
            alt=""
            className="celebration-artwork"
          />
        )}
        <div className="celebration-label">Your Song is Playing!</div>
        <div className="celebration-title">{song.title}</div>
        <div className="celebration-artist">{song.artist}</div>
        <div className="celebration-dismiss">Tap to dismiss</div>
      </div>
    </div>
  );
}
