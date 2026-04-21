"use client";

import type { CollectMyPicksResponse } from "../../../../lib/api";

interface Props {
  picks: CollectMyPicksResponse;
}

export default function MyPicksPanel({ picks }: Props) {
  const isEmpty = picks.submitted.length === 0 && picks.upvoted.length === 0;

  return (
    <section style={{ marginTop: 24 }}>
      <h2>My Picks</h2>
      {picks.is_top_contributor && (
        <p style={{ color: "#ffcc00" }}>🏆 Top contributor for this event</p>
      )}
      {isEmpty ? (
        <p>No picks yet — search for a song below!</p>
      ) : (
        <ul>
          {picks.submitted.map((p) => (
            <li key={`s-${p.id}`}>
              {p.title} — {p.artist}
              <span style={{ marginLeft: 8, padding: "2px 6px", background: "#333" }}>
                {p.status}
              </span>
              {picks.first_suggestion_ids.includes(p.id) && (
                <span style={{ marginLeft: 8 }}>⭐ First to suggest</span>
              )}
            </li>
          ))}
          {picks.upvoted.map((p) => (
            <li key={`u-${p.id}`}>
              {p.title} — {p.artist} <em>(upvoted)</em>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
