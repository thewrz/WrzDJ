/**
 * Event health check service.
 *
 * Validates that an event still exists via the public API endpoint.
 * No authentication required — uses the public nowplaying endpoint
 * which returns appropriate HTTP status codes.
 */

export type EventHealthStatus = 'active' | 'not_found' | 'expired' | 'error';

/**
 * Check whether an event still exists and is active.
 *
 * Uses GET /api/public/e/{code}/nowplaying:
 *   200 → active (event exists, may or may not have a track playing)
 *   404 → not_found (event was deleted)
 *   410 → expired (event expired or archived)
 *   other → error (network issue, server error — don't act on this)
 */
export async function checkEventHealth(
  apiUrl: string,
  eventCode: string,
): Promise<EventHealthStatus> {
  try {
    const response = await fetch(
      `${apiUrl}/api/public/e/${encodeURIComponent(eventCode)}/nowplaying`,
    );

    if (response.ok) return 'active';
    if (response.status === 404) return 'not_found';
    if (response.status === 410) return 'expired';

    return 'error';
  } catch {
    return 'error';
  }
}
