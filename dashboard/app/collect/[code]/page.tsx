"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  apiClient,
  CollectEventPreview,
  CollectLeaderboardResponse,
  CollectMyPicksResponse,
} from "../../../lib/api";
import FeatureOptInPanel from "./components/FeatureOptInPanel";

const POLL_MS = 5000;

export default function CollectPage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const code = params?.code ?? "";
  const [event, setEvent] = useState<CollectEventPreview | null>(null);
  const [leaderboard, setLeaderboard] = useState<CollectLeaderboardResponse | null>(
    null
  );
  const [myPicks, setMyPicks] = useState<CollectMyPicksResponse | null>(null);
  const [tab, setTab] = useState<"trending" | "all">("trending");
  const [error, setError] = useState<string | null>(null);
  const [hasEmail, setHasEmail] = useState(false);

  const saveEmail = async (email: string) => {
    const resp = await apiClient.setCollectProfile(code, { email });
    setHasEmail(resp.has_email);
  };

  const redirectToJoin = () => {
    sessionStorage.setItem(`wrzdj_live_splash_${code}`, "1");
    router.replace(`/join/${code}`);
  };

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const ev = await apiClient.getCollectEvent(code);
        if (cancelled) return;
        setEvent(ev);
        if (ev.phase === "live" || ev.phase === "closed") {
          redirectToJoin();
          return;
        }
        if (ev.phase === "collection") {
          const [lb, picks] = await Promise.all([
            apiClient.getCollectLeaderboard(code, tab),
            apiClient.getCollectMyPicks(code),
          ]);
          if (!cancelled) {
            setLeaderboard(lb);
            setMyPicks(picks);
          }
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
      if (!cancelled && document.visibilityState === "visible") {
        timer = setTimeout(tick, POLL_MS);
      }
    };

    tick();
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !cancelled) tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [code, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <main style={{ padding: 24 }}>Error: {error}</main>;
  if (!event) return <main style={{ padding: 24 }}>Loading…</main>;

  if (event.phase === "pre_announce") {
    const opens = event.collection_opens_at
      ? new Date(event.collection_opens_at)
      : null;
    return (
      <main style={{ padding: 24 }}>
        <h1>{event.name}</h1>
        <p>Voting opens in {formatCountdown(opens)}</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>{event.name}</h1>
      <p>
        Voting open —{" "}
        {formatCountdown(
          event.live_starts_at ? new Date(event.live_starts_at) : null
        )}{" "}
        until the event goes live
      </p>
      <FeatureOptInPanel hasEmail={hasEmail} onSave={saveEmail} />
      <div style={{ marginTop: 16 }}>
        <button onClick={() => setTab("trending")} aria-pressed={tab === "trending"}>
          Trending
        </button>
        <button onClick={() => setTab("all")} aria-pressed={tab === "all"}>
          All
        </button>
      </div>
      <ul>
        {leaderboard?.requests.map((r) => (
          <li key={r.id}>
            <strong>{r.title}</strong> — {r.artist} (▲ {r.vote_count})
          </li>
        ))}
      </ul>
      <section>
        <h2>My Picks</h2>
        {myPicks?.submitted.length === 0 && myPicks?.upvoted.length === 0 ? (
          <p>No picks yet — search for a song below!</p>
        ) : (
          <ul>
            {myPicks?.submitted.map((r) => (
              <li key={`s-${r.id}`}>
                {r.title} — {r.artist} [{r.status}]
              </li>
            ))}
            {myPicks?.upvoted.map((r) => (
              <li key={`u-${r.id}`}>
                {r.title} — {r.artist} (upvoted)
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function formatCountdown(target: Date | null): string {
  if (!target) return "";
  const diff = target.getTime() - Date.now();
  if (diff <= 0) return "now";
  const hrs = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  const days = Math.floor(hrs / 24);
  if (days >= 1) return `${days}d ${hrs % 24}h`;
  return `${hrs}h ${mins}m`;
}
