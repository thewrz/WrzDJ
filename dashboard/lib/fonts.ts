/**
 * Font family definitions for WrzDJ dashboard.
 *
 * - body:    Condensed sans-serif for the DJ dashboard (more text fits before truncation)
 * - display: Bold display font for kiosk headings (readable at distance)
 * - mono:    Tabular-figures monospace for BPM/key badges (numbers align vertically)
 *
 * Actual font loading happens in app/layout.tsx via next/font/google.
 * These CSS variables and class names are referenced throughout the app.
 */

export type FontRole = 'body' | 'display' | 'mono';

export const FONT_FAMILIES: Record<FontRole, string> = {
  body: 'var(--font-body), "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  display:
    'var(--font-display), "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: 'var(--font-mono), "JetBrains Mono", "SF Mono", "Fira Code", monospace',
};

const CLASS_MAP: Record<string, string> = {
  body: 'font-body',
  display: 'font-display',
  mono: 'font-mono',
};

export function getFontClass(role: FontRole): string {
  return CLASS_MAP[role] ?? 'font-body';
}
