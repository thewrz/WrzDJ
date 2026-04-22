'use client';

import { useState } from 'react';
import type { CollectLeaderboardRow } from '../../../../lib/api';

interface Props {
  rows: CollectLeaderboardRow[];
  tab: 'trending' | 'all';
  onTabChange: (tab: 'trending' | 'all') => void;
  onVote: (requestId: number) => Promise<void>;
}

export default function LeaderboardTabs({ rows, tab, onTabChange, onVote }: Props) {
  const [optimistic, setOptimistic] = useState<Record<number, number>>({});

  const handleVote = async (id: number, currentVotes: number) => {
    setOptimistic((o) => ({ ...o, [id]: currentVotes + 1 }));
    try {
      await onVote(id);
    } catch {
      setOptimistic((o) => {
        const next = { ...o };
        delete next[id];
        return next;
      });
    }
  };

  return (
    <div>
      <div className="collect-tabs">
        <button
          type="button"
          className="collect-tab"
          aria-pressed={tab === 'trending'}
          onClick={() => onTabChange('trending')}
        >
          Trending
        </button>
        <button
          type="button"
          className="collect-tab"
          aria-pressed={tab === 'all'}
          onClick={() => onTabChange('all')}
        >
          All
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="collect-empty">
          {tab === 'trending'
            ? 'Not enough songs added yet! Once others contribute this list will grow.'
            : 'No songs yet — be the first to add one!'}
        </p>
      ) : (
        <ul className="collect-leaderboard">
          {rows.map((r) => {
            const votes = optimistic[r.id] ?? r.vote_count;
            return (
              <li key={r.id} className="collect-row">
                {r.artwork_url ? (
                  <img src={r.artwork_url} alt="" className="collect-row-art" />
                ) : (
                  <div className="collect-row-art" aria-hidden="true" />
                )}
                <div className="collect-row-info">
                  <div className="collect-row-title">{r.title}</div>
                  <div className="collect-row-artist">{r.artist}</div>
                  {r.nickname && (
                    <div className="collect-row-nickname">
                      <em className="nickname-icon">@</em>
                      {r.nickname}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="upvote"
                  className="collect-vote"
                  onClick={() => handleVote(r.id, r.vote_count)}
                >
                  <span className="collect-vote-caret">▲</span>
                  <span>{votes}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
