/** @type {import('next').NextConfig} */

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  `connect-src 'self' ${apiUrl}`,
  "font-src 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig = {
  output: 'standalone',
  allowedDevOrigins: ['192.168.*.*'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
      {
        // Allow OBS/streaming tools to embed overlay pages
        source: '/e/:code/overlay',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors *" },
          // Remove X-Frame-Options for this route (CSP frame-ancestors takes precedence)
          { key: 'X-Frame-Options', value: '' },
        ],
      },
    ];
  },
}

module.exports = nextConfig
