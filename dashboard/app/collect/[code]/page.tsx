'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  apiClient,
  ApiError,
  CollectEventPreview,
  CollectLeaderboardResponse,
  CollectMyPicksResponse,
  SearchResult,
} from '../../../lib/api';
import FeatureOptInPanel from './components/FeatureOptInPanel';
import LeaderboardTabs from './components/LeaderboardTabs';
import MyPicksPanel from './components/MyPicksPanel';
import SubmitBar from './components/SubmitBar';

const POLL_MS = 5000;

export default function CollectPage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const code = params?.code ?? '';
  const [event, setEvent] = useState<CollectEventPreview | null>(null);
  const [leaderboard, setLeaderboard] = useState<CollectLeaderboardResponse | null>(null);
  const [myPicks, setMyPicks] = useState<CollectMyPicksResponse | null>(null);
  // Canonical "I have voted on this request" set — covers both upvotes AND
  // votes on my own submissions (which don't appear in `upvoted` because the
  // backend dedupes that against `submitted` for display purposes).
  const votedIds = new Set<number>(myPicks?.voted_request_ids ?? []);
  const [tab, setTab] = useState<'trending' | 'all'>('all');
  const [error, setError] = useState<string | null>(null);
  const [hasEmail, setHasEmail] = useState(false);
  const [nickname, setNickname] = useState<string | null>(null);
  const [profile, setProfile] = useState<{
    submission_count: number;
    submission_cap: number;
  } | null>(null);

  // Search modal state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const saveProfile = async (data: { nickname?: string; email?: string }) => {
    const resp = await apiClient.setCollectProfile(code, data);
    setHasEmail(resp.has_email);
    setNickname(resp.nickname);
    if (resp.nickname) {
      localStorage.setItem(`wrzdj_collect_nickname_${code}`, resp.nickname);
    }
  };

  useEffect(() => {
    if (!code) return;
    apiClient.setCollectProfile(code, {}).then((p) => {
      setProfile({ submission_count: p.submission_count, submission_cap: p.submission_cap });
      setHasEmail(p.has_email);
      setNickname(p.nickname);
      if (p.nickname) {
        localStorage.setItem(`wrzdj_collect_nickname_${code}`, p.nickname);
      }
    });
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSearch = () => {
    setSearchOpen(true);
    setSearchQuery('');
    setSearchResults([]);
    setSubmitError(null);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
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
      const submitNickname =
        nickname ?? localStorage.getItem(`wrzdj_collect_nickname_${code}`) ?? undefined;
      await apiClient.submitCollectRequest(code, {
        song_title: song.title,
        artist: song.artist,
        source: song.source,
        source_url: song.url ?? undefined,
        artwork_url: song.album_art ?? undefined,
        nickname: submitNickname,
      });
      const [p, lb] = await Promise.all([
        apiClient.setCollectProfile(code, {}),
        apiClient.getCollectLeaderboard(code, tab),
      ]);
      setProfile({ submission_count: p.submission_count, submission_cap: p.submission_cap });
      setLeaderboard(lb);
      closeSearch();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setSubmitError('Picks limit reached');
      } else {
        setSubmitError('Failed to submit. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const redirectToJoin = () => {
    sessionStorage.setItem(`wrzdj_live_splash_${code}`, '1');
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
        if (ev.phase === 'live' || ev.phase === 'closed') {
          redirectToJoin();
          return;
        }
        if (ev.phase === 'collection') {
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
      if (!cancelled && document.visibilityState === 'visible') {
        timer = setTimeout(tick, POLL_MS);
      }
    };

    tick();
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !cancelled) tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [code, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <main className="collect-page">
        <div className="collect-container">
          <div className="collect-error">Error: {error}</div>
        </div>
      </main>
    );
  }
  if (!event) {
    return (
      <main className="collect-page">
        <div className="loading">Loading…</div>
      </main>
    );
  }

  const bannerNode = event.banner_url ? (
    <div className="join-banner-bg">
      <img src={event.banner_url} alt="" />
    </div>
  ) : null;

  if (event.phase === 'pre_announce') {
    const opens = event.collection_opens_at ? new Date(event.collection_opens_at) : null;
    return (
      <main className="collect-page">
        {bannerNode}
        <div className="collect-container">
          <div className="collect-preannounce">
            <div className="collect-phase-badge pre-announce">
              <span>🎟️</span>
              <span>Pre-event voting</span>
            </div>
            <h1 className="collect-title">{event.name}</h1>
            <div className="collect-preannounce-count">{formatCountdown(opens)}</div>
            <p className="collect-countdown">until voting opens</p>
          </div>
        </div>
      </main>
    );
  }

  const liveStarts = event.live_starts_at ? new Date(event.live_starts_at) : null;

  return (
    <main className="collect-page">
      {bannerNode}
      <div className="collect-container">
        <header className="collect-header">
          <div className="collect-phase-badge">
            <span>🎟️</span>
            <span>Pre-event voting is open</span>
          </div>
          <h1 className="collect-title">{event.name}</h1>
          {liveStarts && (
            <p className="collect-countdown">
              Live show in <strong>{formatCountdown(liveStarts)}</strong>
            </p>
          )}
          {nickname && (
            <p className="collect-countdown" style={{ marginTop: '0.25rem' }}>
              Voting as <strong>@{nickname}</strong>
            </p>
          )}
        </header>

        <FeatureOptInPanel
          hasEmail={hasEmail}
          initialNickname={nickname}
          onSave={saveProfile}
        />

        <section className="collect-section">
          <LeaderboardTabs
            rows={leaderboard?.requests ?? []}
            tab={tab}
            onTabChange={setTab}
            onVote={(id) => apiClient.voteCollectRequest(code, id)}
            votedIds={votedIds}
          />
        </section>

        {myPicks && <MyPicksPanel picks={myPicks} />}
      </div>

      <SubmitBar
        used={profile?.submission_count ?? 0}
        cap={event.submission_cap_per_guest}
        onOpenSearch={openSearch}
      />

      {searchOpen && (
        <div
          className="collect-search-overlay"
          onClick={closeSearch}
          role="dialog"
          aria-label="Add a song"
        >
          <div className="collect-search-modal" onClick={(e) => e.stopPropagation()}>
            <div className="collect-search-header">
              <h2 style={{ margin: 0, fontSize: '1.1rem', flex: 1 }}>Add a song</h2>
              <button
                type="button"
                className="btn btn-sm collect-optin-dismiss"
                onClick={closeSearch}
                aria-label="Close search"
              >
                ✕
              </button>
            </div>

            {submitError && <div className="collect-error">{submitError}</div>}

            <form onSubmit={handleSearch}>
              <div className="form-group" style={{ marginBottom: '0.5rem' }}>
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
                className="btn btn-primary btn-sm"
                style={{ width: '100%' }}
                disabled={searching}
              >
                {searching ? 'Searching…' : 'Search'}
              </button>
            </form>

            {searchResults.length > 0 && (
              <div className="collect-search-results">
                {searchResults.map((result, index) => (
                  <button
                    type="button"
                    key={result.spotify_id ?? result.url ?? index}
                    className="collect-search-result"
                    disabled={submitting}
                    onClick={() => handleSelectSong(result)}
                    data-testid="collect-search-result"
                  >
                    {result.album_art ? (
                      <img
                        src={result.album_art}
                        alt={result.album ?? result.title}
                        className="collect-row-art"
                      />
                    ) : (
                      <div className="collect-row-art" aria-hidden="true" />
                    )}
                    <div className="collect-row-info">
                      <div className="collect-row-title">{result.title}</div>
                      <div className="collect-row-artist">{result.artist}</div>
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
  if (!target) return '';
  const diff = target.getTime() - Date.now();
  if (diff <= 0) return 'now';
  const hrs = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  const days = Math.floor(hrs / 24);
  if (days >= 1) return `${days}d ${hrs % 24}h`;
  return `${hrs}h ${mins}m`;
}
