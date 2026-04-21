"use client";

import { useState } from "react";
import type { CollectLeaderboardRow } from "../../../../lib/api";

interface Props {
  rows: CollectLeaderboardRow[];
  tab: "trending" | "all";
  onTabChange: (tab: "trending" | "all") => void;
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
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          aria-pressed={tab === "trending"}
          onClick={() => onTabChange("trending")}
        >
          Trending
        </button>
        <button
          aria-pressed={tab === "all"}
          onClick={() => onTabChange("all")}
        >
          All
        </button>
      </div>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {rows.map((r) => {
          const votes = optimistic[r.id] ?? r.vote_count;
          return (
            <li
              key={r.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: 8,
                background: "#1a1a1a",
                marginBottom: 4,
              }}
            >
              <div>
                <strong>{r.title}</strong> — {r.artist}
                {r.nickname && <span style={{ opacity: 0.7 }}> · by @{r.nickname}</span>}
              </div>
              <button
                aria-label="upvote"
                onClick={() => handleVote(r.id, r.vote_count)}
              >
                ▲ {votes}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
