'use client';

import type { CollectMyPicksItem, CollectMyPicksResponse } from '../../../../lib/api';

interface Props {
  picks: CollectMyPicksResponse;
}

const STATUS_CLASS: Record<CollectMyPicksItem['status'], string> = {
  new: 'badge-new',
  accepted: 'badge-accepted',
  playing: 'badge-playing',
  played: 'badge-played',
  rejected: 'badge-rejected',
};

export default function MyPicksPanel({ picks }: Props) {
  const isEmpty = picks.submitted.length === 0 && picks.upvoted.length === 0;

  return (
    <section className="collect-section">
      <h2 className="collect-section-title">My Picks</h2>
      {picks.is_top_contributor && (
        <p className="collect-picks-badge">🏆 Top contributor for this event</p>
      )}
      {isEmpty ? (
        <p className="collect-empty">No picks yet — search for a song below!</p>
      ) : (
        <ul className="collect-leaderboard">
          {picks.submitted.map((p) => (
            <li key={`s-${p.id}`} className="collect-row">
              {p.artwork_url ? (
                <img src={p.artwork_url} alt="" className="collect-row-art" />
              ) : (
                <div className="collect-row-art" aria-hidden="true" />
              )}
              <div className="collect-row-info">
                <div className="collect-row-title">{p.title}</div>
                <div className="collect-row-artist">{p.artist}</div>
                {picks.first_suggestion_ids.includes(p.id) && (
                  <span className="collect-pick-first">⭐ First to suggest</span>
                )}
              </div>
              <span className={`badge ${STATUS_CLASS[p.status]}`}>{p.status}</span>
            </li>
          ))}
          {picks.upvoted.map((p) => (
            <li key={`u-${p.id}`} className="collect-row">
              {p.artwork_url ? (
                <img src={p.artwork_url} alt="" className="collect-row-art" />
              ) : (
                <div className="collect-row-art" aria-hidden="true" />
              )}
              <div className="collect-row-info">
                <div className="collect-row-title">{p.title}</div>
                <div className="collect-row-artist">
                  {p.artist} <em>(upvoted)</em>
                </div>
              </div>
              <span className="badge badge-new">▲ {p.vote_count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
