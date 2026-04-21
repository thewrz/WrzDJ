"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  apiClient,
  ApiError,
  CollectEventPreview,
  CollectLeaderboardResponse,
  CollectMyPicksResponse,
  SearchResult,
} from "../../../lib/api";
import FeatureOptInPanel from "./components/FeatureOptInPanel";
import LeaderboardTabs from "./components/LeaderboardTabs";
import MyPicksPanel from "./components/MyPicksPanel";
import SubmitBar from "./components/SubmitBar";

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
  const [profile, setProfile] = useState<{ submission_count: number; submission_cap: number } | null>(null);

  // Search modal state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const saveEmail = async (email: string) => {
    const resp = await apiClient.setCollectProfile(code, { email });
    setHasEmail(resp.has_email);
  };

  useEffect(() => {
    if (!code) return;
    apiClient.setCollectProfile(code, {}).then((p) => {
      setProfile({ submission_count: p.submission_count, submission_cap: p.submission_cap });
      setHasEmail(p.has_email);
    });
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSearch = () => {
    setSearchOpen(true);
    setSearchQuery("");
    setSearchResults([]);
    setSubmitError(null);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    setSubmitError(null);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const results = await apiClient.eventSearch(code, searchQuery);
      setSearchResults(results);
    } catch {
      try {
        const results = await apiClient.search(searchQuery);
        setSearchResults(results);
      } catch {
        // silently leave results empty
      }
    } finally {
      setSearching(false);
    }
  };

  const handleSelectSong = async (song: SearchResult) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const nickname = localStorage.getItem(`wrzdj_collect_nickname_${code}`) ?? undefined;
      await apiClient.submitCollectRequest(code, {
        song_title: song.title,
        artist: song.artist,
        source: song.source,
        source_url: song.url ?? undefined,
        artwork_url: song.album_art ?? undefined,
        nickname,
      });
      // Refresh profile (submission count) + leaderboard
      const [p, lb] = await Promise.all([
        apiClient.setCollectProfile(code, {}),
        apiClient.getCollectLeaderboard(code, tab),
      ]);
      setProfile({ submission_count: p.submission_count, submission_cap: p.submission_cap });
      setLeaderboard(lb);
      closeSearch();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setSubmitError("Picks limit reached");
      } else {
        setSubmitError("Failed to submit. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
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
      <LeaderboardTabs
        rows={leaderboard?.requests ?? []}
        tab={tab}
        onTabChange={setTab}
        onVote={(id) => apiClient.voteCollectRequest(code, id)}
      />
      {myPicks && <MyPicksPanel picks={myPicks} />}
      <SubmitBar
        used={profile?.submission_count ?? 0}
        cap={event.submission_cap_per_guest}
        onOpenSearch={openSearch}
      />

      {searchOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            overflowY: "auto",
            padding: "1rem",
          }}
          onClick={closeSearch}
        >
          <div
            className="card"
            style={{ width: "100%", maxWidth: 480, marginTop: "2rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0 }}>Add a song</h2>
              <button
                onClick={closeSearch}
                style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: "1.25rem", cursor: "pointer" }}
                aria-label="Close search"
              >
                ✕
              </button>
            </div>

            {submitError && (
              <p style={{ color: "#ef4444", marginBottom: "1rem" }}>{submitError}</p>
            )}

            <form onSubmit={handleSearch} style={{ marginBottom: "1rem" }}>
              <div className="form-group">
                <input
                  type="text"
                  className="input"
                  placeholder="Search for a song or artist…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  required
                  autoFocus
                  data-testid="collect-search-input"
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: "100%" }}
                disabled={searching}
              >
                {searching ? "Searching…" : "Search"}
              </button>
            </form>

            {searchResults.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {searchResults.map((result, index) => (
                  <button
                    key={result.spotify_id ?? result.url ?? index}
                    className="request-item"
                    style={{
                      cursor: submitting ? "default" : "pointer",
                      border: "none",
                      textAlign: "left",
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                    }}
                    disabled={submitting}
                    onClick={() => handleSelectSong(result)}
                    data-testid="collect-search-result"
                  >
                    {result.album_art && (
                      <img
                        src={result.album_art}
                        alt={result.album ?? result.title}
                        style={{ width: 48, height: 48, borderRadius: 4, objectFit: "cover", flexShrink: 0 }}
                      />
                    )}
                    <div className="request-info" style={{ flex: 1, minWidth: 0 }}>
                      <h3 style={{ fontSize: "1rem", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {result.title}
                      </h3>
                      <p style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {result.artist}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
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
