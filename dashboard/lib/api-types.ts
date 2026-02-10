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
  // Tidal sync status
  tidal_track_id: string | null;
  tidal_sync_status: 'pending' | 'synced' | 'not_found' | 'error' | null;
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
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
