/**
 * CSS variable maps for each theme.
 *
 * - dark:          Current default (pure dark, standard contrast)
 * - high-contrast: Boosted contrast for bright environments or accessibility
 * - daylight:      Bright dark mode for outdoor/daylight gigs
 */

export type Theme = 'dark' | 'high-contrast' | 'daylight';

export const THEMES: readonly Theme[] = ['dark', 'high-contrast', 'daylight'] as const;

const THEME_VARS: Record<Theme, Record<string, string>> = {
  dark: {
    '--bg': '#0a0a0a',
    '--card': '#1a1a1a',
    '--text': '#ededed',
    '--text-secondary': '#9ca3af',
    '--text-tertiary': '#6b7280',
    '--border': '#333333',
  },
  'high-contrast': {
    '--bg': '#000000',
    '--card': '#1a1a1a',
    '--text': '#ffffff',
    '--text-secondary': '#d1d5db',
    '--text-tertiary': '#9ca3af',
    '--border': '#555555',
  },
  daylight: {
    '--bg': '#1a1a1a',
    '--card': '#262626',
    '--text': '#ffffff',
    '--text-secondary': '#d1d5db',
    '--text-tertiary': '#9ca3af',
    '--border': '#444444',
  },
};

export function getThemeVars(theme: Theme): Record<string, string> {
  return { ...THEME_VARS[theme] };
}
