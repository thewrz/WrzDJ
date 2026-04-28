'use client';

import { useEffect, useState } from 'react';
import type { CollectLeaderboardRow } from '../../../../lib/api';

const ACCENT = '#00f0ff';
const ACCENT2 = '#ff2bd6';

const GRADIENTS = [
  'linear-gradient(135deg, #ff006e, #8338ec, #3a86ff)',
  'linear-gradient(135deg, #ffbe0b, #fb5607)',
  'linear-gradient(135deg, #06ffa5, #0077b6)',
  'linear-gradient(135deg, #ff6b9d, #c44569)',
  'linear-gradient(135deg, #f72585, #7209b7)',
  'linear-gradient(135deg, #4cc9f0, #4361ee)',
  'linear-gradient(135deg, #f15bb5, #fee440)',
  'linear-gradient(135deg, #2dc653, #25a244)',
  'linear-gradient(135deg, #ef476f, #ffd166)',
];
function artGradient(seed: string) {
  const code = (seed.charCodeAt(0) || 0) + (seed.charCodeAt(1) || 0);
  return GRADIENTS[code % GRADIENTS.length];
}

interface Props {
  rows: CollectLeaderboardRow[];
  tab: 'trending' | 'all';
  onTabChange: (tab: 'trending' | 'all') => void;
  onVote: (requestId: number) => Promise<void>;
  votedIds: ReadonlySet<number>;
}

export default function LeaderboardTabs({ rows, tab, onTabChange, onVote, votedIds }: Props) {
  const [optimistic, setOptimistic] = useState<Record<number, number>>({});
  const [justVoted, setJustVoted] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    setOptimistic((prev) => {
      const next: Record<number, number> = {};
      for (const [id, guess] of Object.entries(prev)) {
        const numericId = Number(id);
        if (!votedIds.has(numericId)) next[numericId] = guess;
      }
      return next;
    });
  }, [rows, votedIds]);

  const hasVoted = (id: number) => votedIds.has(id) || justVoted.has(id);

  const handleVote = async (id: number, currentVotes: number) => {
    if (hasVoted(id)) return;
    setOptimistic((o) => ({ ...o, [id]: currentVotes + 1 }));
    setJustVoted((prev) => { const n = new Set(prev); n.add(id); return n; });
    try {
      await onVote(id);
    } catch {
      setOptimistic((o) => { const n = { ...o }; delete n[id]; return n; });
      setJustVoted((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const border = 'rgba(255,255,255,0.08)';
  const surface = 'rgba(255,255,255,0.04)';
  const subFg = 'rgba(255,255,255,0.5)';
  const subFg2 = 'rgba(255,255,255,0.35)';

  const maxVotes = Math.max(...rows.map(r => optimistic[r.id] ?? r.vote_count), 1);

  return (
    <div>
      {/* Tab strip */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 12 }}>
        {(['trending', 'all'] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => onTabChange(t)}
            style={{
              padding: '6px 12px', borderRadius: 99, cursor: 'pointer',
              fontFamily: 'var(--font-mono, monospace)', fontSize: 10.5, fontWeight: 700, letterSpacing: 1.2,
              background: tab === t ? '#fff' : 'transparent',
              color: tab === t ? '#06060a' : subFg,
              border: tab === t ? 'none' : `1px solid ${border}`,
              transition: 'background 150ms, color 150ms',
            }}
          >
            {t === 'trending' ? 'TRENDING' : 'ALL'}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono, monospace)', fontSize: 9.9, color: subFg, letterSpacing: 1.2 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: ACCENT, animation: 'gst-live-pulse 1.6s infinite' }} />
          LIVE
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="collect-empty">
          {tab === 'trending'
            ? 'Not enough songs added yet! Once others contribute this list will grow.'
            : 'No songs yet — be the first to add one!'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {rows.map((r, i) => {
            const votes = optimistic[r.id] ?? r.vote_count;
            const voted = hasVoted(r.id);
            const pct = (votes / maxVotes) * 100;
            const isTop3 = i < 3;
            const rankColors = [ACCENT, '#fff', subFg];

            return (
              <div
                key={r.id}
                className="gst-collect-row"
                style={{
                  background: surface,
                  border: `1px solid ${border}`,
                }}
              >
                {/* Vote bar fill */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, bottom: 0,
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${isTop3 ? ACCENT : ACCENT2}1c, transparent 85%)`,
                  pointerEvents: 'none',
                  transition: 'width 360ms cubic-bezier(.2,.8,.2,1)',
                }} />

                {/* #1 top-edge glow */}
                {i === 0 && (
                  <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, background: `linear-gradient(90deg, transparent, ${ACCENT}, transparent)` }} />
                )}

                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 9, width: '100%' }}>
                  {/* Rank bubble */}
                  <div style={{
                    width: 26, height: 26, flexShrink: 0, borderRadius: 6,
                    background: isTop3 ? rankColors[i] : 'transparent',
                    border: isTop3 ? 'none' : `1px solid ${border}`,
                    color: isTop3 ? '#000' : subFg2,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--font-mono, monospace)', fontSize: 12.1, fontWeight: 800,
                    boxShadow: i === 0 ? `0 0 12px ${ACCENT}50` : 'none',
                  }}>
                    {i + 1}
                  </div>

                  {/* Artwork */}
                  <div style={{
                    width: 40, height: 40, borderRadius: 7, flexShrink: 0, overflow: 'hidden',
                    background: artGradient(r.title + r.artist),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 800, color: '#fff',
                  }}>
                    {r.artwork_url
                      ? <img src={r.artwork_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : `${r.title[0] ?? '?'}${r.artist[0] ?? ''}`.toUpperCase()
                    }
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="collect-row-title">{r.title}</div>
                    <div className="collect-row-artist">{r.artist}</div>
                    {r.nickname && (
                      <div className="collect-row-nickname">
                        <em className="nickname-icon">@</em>{r.nickname}
                      </div>
                    )}
                  </div>

                  {/* Vote count + button */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                      <span style={{
                        fontFamily: 'var(--font-mono, monospace)', fontSize: 16.5, fontWeight: 800,
                        lineHeight: '1', color: isTop3 ? rankColors[i] : '#fff',
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {votes}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 7.7, color: subFg2, letterSpacing: 1, marginTop: 2 }}>
                        VOTES
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={voted ? 'upvoted' : 'upvote'}
                      aria-pressed={voted}
                      className={`gst-collect-vote-btn${voted ? ' voted' : ''}`}
                      disabled={voted}
                      onClick={() => handleVote(r.id, r.vote_count)}
                    >
                      <svg width="11" height="7" viewBox="0 0 11 7" fill="none">
                        <path d="M1 6L5.5 1L10 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
