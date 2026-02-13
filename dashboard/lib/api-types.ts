export interface Event {
  id: number;
  code: string;
  name: string;
  created_at: string;
  expires_at: string;
  is_active: boolean;
  join_url: string | null;
  // Tidal sync settings
  tidal_sync_enabled: boolean;
  tidal_playlist_id: string | null;
  // Beatport sync settings
  beatport_sync_enabled: boolean;
  beatport_playlist_id: string | null;
  // Banner
  banner_url: string | null;
  banner_kiosk_url: string | null;
  banner_colors: string[] | null;
  // Requests open/closed
  requests_open: boolean;
}

export interface ArchivedEvent extends Event {
  status: 'expired' | 'archived';
  request_count: number;
  archived_at: string | null;
}

export interface SongRequest {
  id: number;
  event_id: number;
  song_title: string;
  artist: string;
  source: string;
  source_url: string | null;
  artwork_url: string | null;
  note: string | null;
  status: 'new' | 'accepted' | 'playing' | 'played' | 'rejected';
  created_at: string;
  updated_at: string;
  is_duplicate?: boolean;
  // Search intent
  raw_search_query: string | null;
  // Tidal sync status
  tidal_track_id: string | null;
  tidal_sync_status: 'pending' | 'synced' | 'not_found' | 'error' | null;
  // Multi-service sync results (JSON string)
  sync_results_json: string | null;
  // Voting
  vote_count: number;
}

export interface PublicRequestInfo {
  id: number;
  title: string;
  artist: string;
  artwork_url: string | null;
  vote_count: number;
}

export interface GuestRequestInfo extends PublicRequestInfo {
  status: 'new' | 'accepted';
}

export interface GuestRequestListResponse {
  event: { code: string; name: string };
  requests: GuestRequestInfo[];
}

export interface HasRequestedResponse {
  has_requested: boolean;
}

export interface VoteResponse {
  status: string;
  vote_count: number;
  has_voted: boolean;
}

export interface KioskDisplay {
  event: { code: string; name: string };
  qr_join_url: string;
  accepted_queue: PublicRequestInfo[];
  now_playing: PublicRequestInfo | null;
  now_playing_hidden: boolean;
  requests_open: boolean;
  updated_at: string;
  banner_url: string | null;
  banner_kiosk_url: string | null;
  banner_colors: string[] | null;
}

export interface DisplaySettingsResponse {
  status: string;
  now_playing_hidden: boolean;
  now_playing_auto_hide_minutes: number;
  requests_open: boolean;
}

export interface SearchResult {
  artist: string;
  title: string;
  album: string | null;
  popularity: number;
  spotify_id: string | null;
  album_art: string | null;
  preview_url: string | null;
  url: string | null;
  source: 'spotify' | 'beatport';
}

/** StageLinQ now-playing track info */
export interface NowPlayingInfo {
  title: string;
  artist: string;
  album: string | null;
  album_art_url: string | null;
  spotify_uri: string | null;
  started_at: string;
  source: string;
  matched_request_id: number | null;
  bridge_connected: boolean;
}

/** Single entry in play history */
export interface PlayHistoryItem {
  id: number;
  title: string;
  artist: string;
  album: string | null;
  album_art_url: string | null;
  spotify_uri: string | null;
  matched_request_id: number | null;
  source: string;
  started_at: string;
  ended_at: string | null;
  play_order: number;
}

/** Paginated play history response */
export interface PlayHistoryResponse {
  items: PlayHistoryItem[];
  total: number;
}

/** Tidal account status */
export interface TidalStatus {
  linked: boolean;
  user_id: string | null;
  expires_at: string | null;
  integration_enabled: boolean;
}

/** Tidal search result */
export interface TidalSearchResult {
  track_id: string;
  title: string;
  artist: string;
  album: string | null;
  duration_seconds: number | null;
  cover_url: string | null;
  tidal_url: string | null;
}

/** Tidal event settings */
export interface TidalEventSettings {
  tidal_sync_enabled: boolean;
  tidal_playlist_id: string | null;
}

/** Tidal sync result */
export interface TidalSyncResult {
  request_id: number;
  status: 'pending' | 'synced' | 'not_found' | 'error';
  tidal_track_id: string | null;
  error: string | null;
}

/** Beatport account status */
export interface BeatportStatus {
  linked: boolean;
  expires_at: string | null;
  configured: boolean;
  subscription: string | null;
  integration_enabled: boolean;
}

/** Beatport search result */
export interface BeatportSearchResult {
  track_id: string;
  title: string;
  artist: string;
  mix_name: string | null;
  label: string | null;
  genre: string | null;
  bpm: number | null;
  key: string | null;
  duration_seconds: number | null;
  cover_url: string | null;
  beatport_url: string | null;
  release_date: string | null;
}

/** Beatport event settings */
export interface BeatportEventSettings {
  beatport_sync_enabled: boolean;
}

/** Per-service sync result entry from sync_results_json */
export interface SyncResultEntry {
  service: string;
  status: 'matched' | 'added' | 'not_found' | 'error';
  track_id: string | null;
  track_title: string | null;
  track_artist: string | null;
  confidence: number | null;
  url: string | null;
  duration_seconds: number | null;
  playlist_id: string | null;
  error: string | null;
}

export interface SystemStats {
  total_users: number;
  active_users: number;
  pending_users: number;
  total_events: number;
  active_events: number;
  total_requests: number;
}

export interface AdminUser {
  id: number;
  username: string;
  is_active: boolean;
  role: string;
  created_at: string;
  event_count: number;
}

export interface AdminEvent {
  id: number;
  code: string;
  name: string;
  owner_username: string;
  owner_id: number;
  created_at: string;
  expires_at: string;
  is_active: boolean;
  request_count: number;
}

export interface SystemSettings {
  registration_enabled: boolean;
  search_rate_limit_per_minute: number;
  spotify_enabled: boolean;
  tidal_enabled: boolean;
  beatport_enabled: boolean;
  bridge_enabled: boolean;
}

/** Capability status for integration services */
export type CapabilityStatus =
  | 'yes'
  | 'no'
  | 'not_implemented'
  | 'configured'
  | 'not_configured';

/** Capability matrix for a single service */
export interface ServiceCapabilities {
  auth: CapabilityStatus;
  catalog_search: CapabilityStatus;
  playlist_sync: CapabilityStatus;
}

/** Full status for a single integration */
export interface IntegrationServiceStatus {
  service: string;
  display_name: string;
  enabled: boolean;
  configured: boolean;
  capabilities: ServiceCapabilities;
  last_check_error: string | null;
}

/** Response from GET /api/admin/integrations */
export interface IntegrationHealthResponse {
  services: IntegrationServiceStatus[];
}

/** Response from PATCH /api/admin/integrations/{service} */
export interface IntegrationToggleResponse {
  service: string;
  enabled: boolean;
}

/** Response from POST /api/admin/integrations/{service}/check */
export interface IntegrationCheckResponse {
  service: string;
  healthy: boolean;
  capabilities: ServiceCapabilities;
  error: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** Recommended track from the suggestion engine */
export interface RecommendedTrack {
  title: string;
  artist: string;
  bpm: number | null;
  key: string | null;
  genre: string | null;
  score: number;
  bpm_score: number;
  key_score: number;
  genre_score: number;
  source: string;
  track_id: string | null;
  url: string | null;
  cover_url: string | null;
  duration_seconds: number | null;
}

/** Music profile of an event derived from its requests */
export interface EventMusicProfile {
  avg_bpm: number | null;
  bpm_range_low: number | null;
  bpm_range_high: number | null;
  dominant_keys: string[];
  dominant_genres: string[];
  track_count: number;
  enriched_count: number;
}

/** Response from POST /api/events/{code}/recommendations */
export interface RecommendationResponse {
  suggestions: RecommendedTrack[];
  profile: EventMusicProfile;
  services_used: string[];
  total_candidates_searched: number;
  llm_available: boolean;
}

/** Playlist info from connected music services */
export interface PlaylistInfo {
  id: string;
  name: string;
  num_tracks: number;
  description: string | null;
  cover_url: string | null;
  source: 'tidal' | 'beatport';
}

/** Response from GET /api/events/{code}/playlists */
export interface PlaylistListResponse {
  playlists: PlaylistInfo[];
}
