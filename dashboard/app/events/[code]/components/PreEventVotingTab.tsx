"use client";

import { useEffect, useState } from "react";
import { apiClient, PendingReviewRow } from "@/lib/api";

interface EventShape {
  code: string;
  name: string;
  collection_opens_at: string | null;
  live_starts_at: string | null;
  submission_cap_per_guest: number;
  collection_phase_override: "force_collection" | "force_live" | null;
  phase: "pre_announce" | "collection" | "live" | "closed";
}

interface Props {
  event: EventShape;
  onEventChange: (next: Partial<EventShape>) => void;
}

type ConfirmAction = "force_collection" | "force_live" | "clear";

export default function PreEventVotingTab({ event, onEventChange }: Props) {
  const [pending, setPending] = useState<PendingReviewRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState<ConfirmAction | null>(null);
  const [topN, setTopN] = useState(20);
  const [minVotes, setMinVotes] = useState(3);

  useEffect(() => {
    refresh();
  }, [event.code]);

  async function refresh() {
    const resp = await apiClient.getPendingReview(event.code);
    setPending(resp.requests);
  }

  async function applyOverride(value: "force_collection" | "force_live" | null) {
    const resp = await apiClient.patchCollectionSettings(event.code, {
      collection_phase_override: value,
    });
    onEventChange(resp);
    setConfirming(null);
  }

  async function bulk(action: string, extras: Record<string, unknown> = {}) {
    await apiClient.bulkReview(event.code, {
      action: action as Parameters<typeof apiClient.bulkReview>[1]["action"],
      ...extras,
    });
    setSelected(new Set());
    refresh();
  }

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/collect/${event.code}`
      : `/collect/${event.code}`;

  function toggleRow(id: number, checked: boolean) {
    const next = new Set(selected);
    if (checked) {
      next.add(id);
    } else {
      next.delete(id);
    }
    setSelected(next);
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>Pre-Event Voting</h2>
      <p>Phase: {event.phase}</p>
      <p>
        Share link: <code>{shareUrl}</code>
        <button
          onClick={() => navigator.clipboard.writeText(shareUrl)}
          style={{ marginLeft: 8 }}
        >
          Copy
        </button>
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setConfirming("force_collection")}>Open collection now</button>
        <button onClick={() => setConfirming("force_live")}>Start live now</button>
        <button onClick={() => setConfirming("clear")}>Clear override</button>
      </div>

      {confirming && (
        <div style={{ padding: 12, background: "#1a1a1a", marginBottom: 16 }}>
          <p>Confirm action: {confirming}</p>
          <button
            onClick={() =>
              applyOverride(confirming === "clear" ? null : confirming)
            }
          >
            Confirm
          </button>
          <button onClick={() => setConfirming(null)} style={{ marginLeft: 8 }}>
            Cancel
          </button>
        </div>
      )}

      <h3>Pending review ({pending.length})</h3>
      <div style={{ marginBottom: 8 }}>
        <label>
          Top N:{" "}
          <input
            type="number"
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
            style={{ width: 60 }}
          />
          <button onClick={() => bulk("accept_top_n", { n: topN })} style={{ marginLeft: 4 }}>
            Accept top N
          </button>
        </label>
        <label style={{ marginLeft: 16 }}>
          ≥ votes:{" "}
          <input
            type="number"
            value={minVotes}
            onChange={(e) => setMinVotes(Number(e.target.value))}
            style={{ width: 60 }}
          />
          <button
            onClick={() => bulk("accept_threshold", { min_votes: minVotes })}
            style={{ marginLeft: 4 }}
          >
            Accept threshold
          </button>
        </label>
        <button
          onClick={() => bulk("reject_remaining")}
          style={{ marginLeft: 16 }}
        >
          Reject remaining
        </button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th></th>
            <th>▲</th>
            <th>Song</th>
            <th>Artist</th>
            <th>Submitted by</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {pending.map((r) => (
            <tr key={r.id}>
              <td>
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={(e) => toggleRow(r.id, e.target.checked)}
                />
              </td>
              <td>{r.vote_count}</td>
              <td>{r.song_title}</td>
              <td>{r.artist}</td>
              <td>{r.nickname ?? "—"}</td>
              <td>
                <button onClick={() => bulk("accept_ids", { request_ids: [r.id] })}>
                  Accept
                </button>
                <button
                  onClick={() => bulk("reject_ids", { request_ids: [r.id] })}
                  style={{ marginLeft: 4 }}
                >
                  Reject
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selected.size > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() =>
              bulk("accept_ids", { request_ids: Array.from(selected) })
            }
          >
            Accept selected ({selected.size})
          </button>
          <button
            onClick={() =>
              bulk("reject_ids", { request_ids: Array.from(selected) })
            }
            style={{ marginLeft: 8 }}
          >
            Reject selected ({selected.size})
          </button>
        </div>
      )}
    </div>
  );
}
