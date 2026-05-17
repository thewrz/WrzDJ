#!/bin/sh
set -e

if [ -n "${NEXT_PUBLIC_API_URL:-}" ]; then
  # Patch both .js chunks (client bundle references) and .json manifests
  # (routes-manifest.json holds the CSP connect-src value baked at build time).
  # Delimiter @ avoids collision with | in URLs and is illegal in the authority
  # component of standard URLs.
  find /app/.next -type f \( -name "*.js" -o -name "*.json" \) \
    -exec sed -i "s@__WRZDJ_API_URL__@${NEXT_PUBLIC_API_URL}@g" {} +
else
  echo "WARNING: NEXT_PUBLIC_API_URL not set. Browser requests will fall back to window.location.hostname:8000. CSP will block cross-origin API calls." >&2
fi

exec "$@"
