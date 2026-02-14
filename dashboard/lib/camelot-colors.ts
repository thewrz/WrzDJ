/**
 * Camelot wheel color mapping for musical key visualization.
 *
 * Maps Camelot positions (1-12) to industry-standard hue-wheel colors,
 * matching the convention used by Mixed In Key, Rekordbox, and other DJ tools.
 * Position 1 = red, progresses through the color wheel to 12 = magenta.
 *
 * Mirrors the backend key parsing in server/app/services/recommendation/camelot.py
 */

export interface CamelotPosition {
  number: number; // 1-12
  letter: string; // "A" (minor) or "B" (major)
}

export interface CamelotColorResult {
  bg: string; // hex background color
  text: string; // hex text color (contrast-safe)
  camelotCode: string | null; // e.g. "8A", null if unparseable
}

/**
 * Industry-standard Camelot wheel colors.
 * 12 positions mapped to equally-spaced hues, tuned for dark-theme visibility.
 */
export const CAMELOT_COLORS: Record<number, { bg: string; text: string }> = {
  1: { bg: '#FF3B30', text: '#FFFFFF' }, // Red
  2: { bg: '#FF6B2C', text: '#FFFFFF' }, // Orange-Red
  3: { bg: '#FF9500', text: '#FFFFFF' }, // Orange
  4: { bg: '#FFCC00', text: '#1a1a1a' }, // Gold/Amber
  5: { bg: '#E5E040', text: '#1a1a1a' }, // Yellow
  6: { bg: '#8BD44A', text: '#1a1a1a' }, // Yellow-Green
  7: { bg: '#30D158', text: '#1a1a1a' }, // Green
  8: { bg: '#32D7A0', text: '#1a1a1a' }, // Teal
  9: { bg: '#3B9EFF', text: '#FFFFFF' }, // Blue
  10: { bg: '#5856D6', text: '#FFFFFF' }, // Indigo
  11: { bg: '#AF52DE', text: '#FFFFFF' }, // Purple
  12: { bg: '#FF2D78', text: '#FFFFFF' }, // Magenta/Pink
};

const FALLBACK_COLOR: CamelotColorResult = {
  bg: '#4a4a4a',
  text: '#9ca3af',
  camelotCode: null,
};

// Key name → Camelot position mapping (mirrors backend camelot.py)
type KeyDef = [number, string, string[]];

const KEY_DEFINITIONS: KeyDef[] = [
  // Minor keys (A ring)
  [1, 'A', ['ab minor', 'ab min', 'abm', 'g# minor', 'g#m', 'g# min']],
  [2, 'A', ['eb minor', 'eb min', 'ebm', 'd# minor', 'd#m', 'd# min']],
  [3, 'A', ['bb minor', 'bb min', 'bbm', 'a# minor', 'a#m', 'a# min']],
  [4, 'A', ['f minor', 'f min', 'fm']],
  [5, 'A', ['c minor', 'c min', 'cm']],
  [6, 'A', ['g minor', 'g min', 'gm']],
  [7, 'A', ['d minor', 'd min', 'dm']],
  [8, 'A', ['a minor', 'a min', 'am']],
  [9, 'A', ['e minor', 'e min', 'em']],
  [10, 'A', ['b minor', 'b min', 'bm']],
  [11, 'A', ['f# minor', 'f# min', 'f#m', 'gb minor', 'gbm', 'gb min']],
  [12, 'A', ['db minor', 'db min', 'dbm', 'c# minor', 'c#m', 'c# min']],
  // Major keys (B ring)
  [1, 'B', ['b major', 'b maj', 'bmaj']],
  [2, 'B', ['f# major', 'f# maj', 'f#maj', 'gb major', 'gbmaj', 'gb maj']],
  [3, 'B', ['db major', 'db maj', 'dbmaj', 'c# major', 'c#maj', 'c# maj']],
  [4, 'B', ['ab major', 'ab maj', 'abmaj', 'g# major', 'g#maj', 'g# maj']],
  [5, 'B', ['eb major', 'eb maj', 'ebmaj', 'd# major', 'd#maj', 'd# maj']],
  [6, 'B', ['bb major', 'bb maj', 'bbmaj', 'a# major', 'a#maj', 'a# maj']],
  [7, 'B', ['f major', 'f maj', 'fmaj']],
  [8, 'B', ['c major', 'c maj', 'cmaj']],
  [9, 'B', ['g major', 'g maj', 'gmaj']],
  [10, 'B', ['d major', 'd maj', 'dmaj']],
  [11, 'B', ['a major', 'a maj', 'amaj']],
  [12, 'B', ['e major', 'e maj', 'emaj']],
];

// Build lookup map at module load
const CAMELOT_MAP = new Map<string, CamelotPosition>();

for (const [num, letter, names] of KEY_DEFINITIONS) {
  const pos: CamelotPosition = { number: num, letter };
  // Camelot code entries: "8A", "8a"
  CAMELOT_MAP.set(`${num}${letter}`, pos);
  CAMELOT_MAP.set(`${num}${letter.toLowerCase()}`, pos);
  for (const name of names) {
    CAMELOT_MAP.set(name, pos);
  }
}

/**
 * Parse a musical key string into a Camelot wheel position.
 * Handles: "A minor", "Am", "8A", "C maj", sharps, flats, Camelot codes.
 */
export function getCamelotPosition(key: string | null): CamelotPosition | null {
  if (!key || !key.trim()) return null;

  const normalized = key.trim().toLowerCase();

  // Direct lookup
  const direct = CAMELOT_MAP.get(normalized);
  if (direct) return direct;

  // Compressed whitespace
  const compressed = normalized.replace(/\s+/g, ' ');
  const compressedResult = CAMELOT_MAP.get(compressed);
  if (compressedResult) return compressedResult;

  // Camelot code pattern: "8A", "12B"
  const stripped = normalized.replace(/\s/g, '');
  if (stripped.length >= 2 && (stripped.endsWith('a') || stripped.endsWith('b'))) {
    const numPart = stripped.slice(0, -1);
    if (/^\d+$/.test(numPart)) {
      const num = parseInt(numPart, 10);
      if (num >= 1 && num <= 12) {
        return { number: num, letter: stripped.slice(-1).toUpperCase() };
      }
    }
  }

  return null;
}

/**
 * Get the display color for a musical key.
 * Returns bg/text colors and the parsed Camelot code.
 * A and B variants of the same position share the same color.
 */
export function getCamelotColor(key: string | null): CamelotColorResult {
  const pos = getCamelotPosition(key);
  if (!pos) return { ...FALLBACK_COLOR };

  const color = CAMELOT_COLORS[pos.number];
  return {
    bg: color.bg,
    text: color.text,
    camelotCode: `${pos.number}${pos.letter}`,
  };
}
