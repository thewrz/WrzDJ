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
import { useGuestIdentity } from '../../../lib/use-guest-identity';
import { IdentityBar } from '../../../components/IdentityBar';
import { NicknameGate, GateResult } from '../../../components/NicknameGate';
import EmailRecoveryButton from '../../../components/EmailRecoveryButton';
import EmailRecoveryModal from '../../../components/EmailRecoveryModal';
import LeaderboardTabs from './components/LeaderboardTabs';
import MyPicksPanel from './components/MyPicksPanel';
import SubmitBar from './components/SubmitBar';

const POLL_MS = 5000;

export default function CollectPage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const code = params?.code ?? '';
  const { reconcileHint, refresh: refreshIdentity } = useGuestIdentity();

  const [event, setEvent] = useState<CollectEventPreview | null>(null);
  const [leaderboard, setLeaderboard] = useState<CollectLeaderboardResponse | null>(null);
  const [myPicks, setMyPicks] = useState<CollectMyPicksResponse | null>(null);
  // Canonical "I have voted on this request" set — covers both upvotes AND
  // votes on my own submissions (which don't appear in `upvoted` because the
  // backend dedupes that against `submitted` for display purposes).
  const votedIds = new Set<number>([
    ...(myPicks?.voted_request_ids ?? []),
    ...(myPicks?.submitted ?? []).map((s) => s.id),
  ]);
  const [tab, setTab] = useState<'trending' | 'all'>('all');
  const [error, setError] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [nickname, setNickname] = useState<string | null>(null);
  const [profile, setProfile] = useState<{
    submission_count: number;
    submission_cap: number;
  } | null>(null);

  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [gateComplete, setGateComplete] = useState(false);
  const handleGateComplete = (result: GateResult) => {
    setNickname(result.nickname || null);
    setEmailVerified(result.emailVerified);
    setProfile({ submission_count: result.submissionCount, submission_cap: result.submissionCap });
    setGateComplete(true);
  };

  // Search modal state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
      const submitNickname = nickname ?? undefined;
      const result = await apiClient.submitCollectRequest(code, {
        song_title: song.title,
        artist: song.artist,
        source: song.source as 'spotify' | 'beatport' | 'tidal' | 'manual',
        source_url: song.url ?? undefined,
        artwork_url: song.album_art ?? undefined,
        nickname: submitNickname,
      });

      if (result.is_duplicate) {
        setSubmitError('Great minds think alike! Your vote has been added.');
      }

      const [p, lb] = await Promise.all([
        apiClient.getCollectProfile(code),
        apiClient.getCollectLeaderboard(code, tab),
      ]);
      setProfile({ submission_count: p.submission_count, submission_cap: p.submission_cap });
      setLeaderboard(lb);

      if (!result.is_duplicate) {
        closeSearch();
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setSubmitError('Picks limit reached');
      } else if (err instanceof ApiError && err.status === 409) {
        setSubmitError('You already picked this one!');
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
    if (!gateComplete) return;
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
  }, [code, tab, gateComplete]);  

  if (!gateComplete) {
    return <NicknameGate code={code} onComplete={handleGateComplete} />;
  }

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
      <main className="collect-page tower">
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
  const accent = '#00f0ff';
  const accent2 = '#ff2bd6';
  const surface = 'rgba(255,255,255,0.04)';
  const border = 'rgba(255,255,255,0.08)';
  const subFg = 'rgba(255,255,255,0.5)';

  return (
    <main className="collect-page tower">
      {/* Ambient glows */}
      <div style={{ position: 'fixed', top: 40, left: -80, width: 280, height: 280, borderRadius: '50%', background: `radial-gradient(circle, ${accent2}28, transparent 70%)`, filter: 'blur(40px)', pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'fixed', bottom: 40, right: -80, width: 280, height: 280, borderRadius: '50%', background: `radial-gradient(circle, ${accent}28, transparent 70%)`, filter: 'blur(40px)', pointerEvents: 'none', zIndex: 0 }} />

      {nickname && (
        <IdentityBar
          nickname={nickname}
          emailVerified={emailVerified}
          onVerified={() => setEmailVerified(true)}
          picksLabel={
            event.submission_cap_per_guest === 0
              ? 'Unlimited picks'
              : `${profile?.submission_count ?? 0} of ${event.submission_cap_per_guest} picks used`
          }
        />
      )}
      {bannerNode}
      <div className="collect-container" style={{ position: 'relative', zIndex: 1 }}>
        <header style={{ padding: '10px 0 14px' }}>
          {/* Phase badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 11px', borderRadius: 99,
            background: `${accent}14`, border: `1px solid ${accent}40`,
            fontFamily: 'var(--font-mono, monospace)', fontSize: 11.6, fontWeight: 700,
            color: accent, letterSpacing: 1.2, marginBottom: 10,
          }}>
            <span>🎟️</span>
            <span>Pre-event voting is open</span>
          </div>

          {/* Top bar row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{
                fontSize: 31.5, fontWeight: 800, letterSpacing: -0.7, lineHeight: 1.05,
                margin: 0, color: '#fff',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {event.name}
              </h1>
              {liveStarts && (
                <p style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12.1, color: subFg, marginTop: 6, letterSpacing: 0.5 }}>
                  Live show in <strong style={{ color: '#fff' }}>{formatCountdown(liveStarts)}</strong>
                </p>
              )}
            </div>
            <div style={{ padding: '5px 10px', borderRadius: 7, border: `1px solid ${border}`, flexShrink: 0 }}>
              <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 15.7, fontWeight: 800, color: '#fff' }}>
                {(leaderboard?.requests ?? []).length}
              </span>
              <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 9, color: subFg, letterSpacing: 1.2, marginTop: 2 }}>
                SONGS
              </div>
            </div>
          </div>
        </header>

        <EmailRecoveryButton
          reconcileHint={reconcileHint}
          onOpen={() => setRecoveryOpen(true)}
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

      <EmailRecoveryModal
        open={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
        onRecovered={async () => {
          await refreshIdentity();
          // The polling loop (useEffect keyed on code/tab/gateComplete) re-uses
          // the updated cookie on its next tick (~5 s). No explicit refetch
          // needed — the merged guest_id propagates automatically via the
          // cookie on the next apiClient.getCollectMyPicks() call.
        }}
      />

      {searchOpen && (
        <div
          className="gst-request-sheet"
          onClick={closeSearch}
          role="dialog"
          aria-label="Request a song"
          style={{ background: '#0a0a12' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
          >
            {/* Header */}
            <div style={{ padding: '12px 18px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 1 }}>
              <div style={{ fontSize: 26.6, fontWeight: 800, letterSpacing: -0.5, color: '#fff' }}>Request a song</div>
              <button
                type="button"
                onClick={closeSearch}
                aria-label="Close search"
                style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: surface, border: `1px solid ${border}`, color: '#fff',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14">
                  <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            {submitError && <div className="collect-error" style={{ margin: '0 18px 8px' }}>{submitError}</div>}

            <div style={{ padding: '6px 18px 12px', position: 'relative', zIndex: 1 }}>
              <form onSubmit={handleSearch}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 14px', borderRadius: 14,
                  background: surface, border: `1px solid ${border}`,
                  boxShadow: `inset 0 0 0 1px ${accent}30`,
                }}>
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: subFg }}>
                    <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  <input
                    type="text"
                    placeholder="Search for a song or artist…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    required
                    autoFocus
                    data-testid="collect-search-input"
                    style={{
                      flex: 1, background: 'transparent', border: 'none',
                      color: '#fff', fontFamily: 'var(--font-grotesk, inherit)', fontSize: 18.2, fontWeight: 500,
                      outline: 'none',
                    }}
                  />
                </div>
                <button
                  type="submit"
                  style={{
                    width: '100%', marginTop: 8, height: 44, borderRadius: 10,
                    background: `linear-gradient(90deg, ${accent}, ${accent2})`,
                    border: 'none', color: '#000',
                    fontFamily: 'var(--font-grotesk, system-ui)', fontSize: 16.9, fontWeight: 800,
                    cursor: searching ? 'default' : 'pointer', opacity: searching ? 0.7 : 1,
                  }}
                  disabled={searching}
                >
                  {searching ? 'Searching…' : 'Search'}
                </button>
              </form>
            </div>

            {searchResults.length > 0 && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '0 18px 80px', position: 'relative', zIndex: 1 }}>
                {searchResults.map((result, index) => (
                  <button
                    type="button"
                    key={result.spotify_id ?? result.url ?? index}
                    disabled={submitting}
                    onClick={() => handleSelectSong(result)}
                    data-testid="collect-search-result"
                    style={{
                      width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12,
                      padding: '11px 12px', borderRadius: 12, marginBottom: 6,
                      background: surface, border: `1px solid ${border}`,
                      color: '#fff', cursor: 'pointer',
                    }}
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
