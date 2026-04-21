"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
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

const collectionSchema = z
  .object({
    collection_opens_at: z.string().optional(),
    live_starts_at: z.string().optional(),
    submission_cap_per_guest: z.number().int().min(0).max(100).optional(),
  })
  .refine(
    (v) => {
      if (v.collection_opens_at && v.live_starts_at) {
        return new Date(v.collection_opens_at) < new Date(v.live_starts_at);
      }
      return true;
    },
    { message: "Collection opens must be before live starts" }
  );

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  // Chop seconds + timezone to get "YYYY-MM-DDTHH:mm"
  return iso.slice(0, 16);
}

function toIso(local: string): string | null {
  if (!local) return null;
  return new Date(local).toISOString();
}

export default function PreEventVotingTab({ event, onEventChange }: Props) {
  const [pending, setPending] = useState<PendingReviewRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState<ConfirmAction | null>(null);
  const [topN, setTopN] = useState(20);
  const [minVotes, setMinVotes] = useState(3);

  // Collection settings form state
  const [collectionOpensAt, setCollectionOpensAt] = useState(
    toDatetimeLocal(event.collection_opens_at)
  );
  const [liveStartsAt, setLiveStartsAt] = useState(
    toDatetimeLocal(event.live_starts_at)
  );
  const [submissionCap, setSubmissionCap] = useState(
    event.submission_cap_per_guest
  );
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);

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

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSettingsError(null);
    setSettingsSaved(false);

    const parsed = collectionSchema.safeParse({
      collection_opens_at: collectionOpensAt || undefined,
      live_starts_at: liveStartsAt || undefined,
      submission_cap_per_guest: submissionCap,
    });

    if (!parsed.success) {
      setSettingsError(parsed.error.issues[0].message);
      return;
    }

    setSavingSettings(true);
    try {
      const resp = await apiClient.patchCollectionSettings(event.code, {
        collection_opens_at: toIso(collectionOpensAt),
        live_starts_at: toIso(liveStartsAt),
        submission_cap_per_guest: submissionCap,
      });
      onEventChange(resp);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
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

      {/* Collection settings */}
      <div className="card" style={{ marginBottom: "1.5rem", padding: "1rem" }}>
        <div style={{ fontWeight: 600, marginBottom: "0.75rem" }}>Collection Settings</div>
        <form onSubmit={handleSaveSettings}>
          <div className="form-group">
            <label htmlFor="collection-opens-at" style={{ fontSize: "0.875rem" }}>
              Collection opens at
            </label>
            <input
              id="collection-opens-at"
              type="datetime-local"
              className="input"
              value={collectionOpensAt}
              onChange={(e) => setCollectionOpensAt(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="live-starts-at" style={{ fontSize: "0.875rem" }}>
              Live starts at
            </label>
            <input
              id="live-starts-at"
              type="datetime-local"
              className="input"
              value={liveStartsAt}
              onChange={(e) => setLiveStartsAt(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="submission-cap" style={{ fontSize: "0.875rem" }}>
              Submission cap per guest
            </label>
            <input
              id="submission-cap"
              type="number"
              min={0}
              max={100}
              className="input"
              value={submissionCap}
              onChange={(e) => setSubmissionCap(Number(e.target.value))}
              style={{ width: "6rem" }}
            />
            <p style={{ color: "#9ca3af", fontSize: "0.75rem", margin: "0.25rem 0 0" }}>
              0 = unlimited picks per guest
            </p>
          </div>
          {settingsError && (
            <p style={{ color: "#f87171", fontSize: "0.875rem", marginBottom: "0.5rem" }}>
              {settingsError}
            </p>
          )}
          {settingsSaved && (
            <p style={{ color: "#4ade80", fontSize: "0.875rem", marginBottom: "0.5rem" }}>
              Settings saved.
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-sm" disabled={savingSettings}>
            {savingSettings ? "Saving..." : "Save settings"}
          </button>
        </form>
      </div>

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
