/**
 * BPM proximity color utility for DJ dashboard badges.
 *
 * Colors BPM values based on how close they are to the event's average BPM:
 * - "match" (green): within ±5 BPM — harmonically safe to mix
 * - "near" (amber): 6-15 BPM away — mixable with pitch adjustment
 * - "far" (red): >15 BPM away — significant tempo mismatch
 * - "neutral" (gray): no comparison data available
 *
 * Also recognizes half-time (0.5x) and double-time (2.0x) relationships,
 * mirroring the backend scorer in server/app/services/recommendation/scorer.py
 *
 * Outlier BPMs (detected by bpm-stats.ts) are forced to "neutral" — they
 * shouldn't show red just because they're far from a cluster they don't belong to.
 */

export type BpmTier = 'match' | 'near' | 'far' | 'neutral';

export interface BpmColorResult {
  bg: string;
  text: string;
  tier: BpmTier;
}

const TIER_COLORS: Record<BpmTier, { bg: string; text: string }> = {
  match: { bg: '#1B4332', text: '#4ADE80' },   // Green — safe mix
  near: { bg: '#422006', text: '#FBBF24' },     // Amber — pitch adjust needed
  far: { bg: '#450A0A', text: '#F87171' },       // Red — tempo mismatch
  neutral: { bg: '#374151', text: '#9CA3AF' },   // Gray — no data
};

const MATCH_THRESHOLD = 5;
const NEAR_THRESHOLD = 15;

/**
 * Determine the closest effective BPM difference accounting for half/double time.
 * DJs commonly mix at 0.5x or 2.0x the tempo — treat those as close matches.
 */
function effectiveBpmDiff(bpm: number, avgBpm: number): number {
  const direct = Math.abs(bpm - avgBpm);
  const halfTime = Math.abs(bpm - avgBpm * 0.5);
  const doubleTime = Math.abs(bpm - avgBpm * 2.0);
  return Math.min(direct, halfTime, doubleTime);
}

/**
 * Get the display color for a BPM value relative to the event's average BPM.
 * When `isOutlier` is true, the BPM is outside the cluster and gets neutral gray.
 */
export function getBpmColor(
  bpm: number | null,
  avgBpm: number | null,
  isOutlier?: boolean,
): BpmColorResult {
  if (bpm == null || avgBpm == null || isOutlier) {
    return { ...TIER_COLORS.neutral, tier: 'neutral' };
  }

  const diff = effectiveBpmDiff(bpm, avgBpm);

  let tier: BpmTier;
  if (diff <= MATCH_THRESHOLD) {
    tier = 'match';
  } else if (diff <= NEAR_THRESHOLD) {
    tier = 'near';
  } else {
    tier = 'far';
  }

  return { ...TIER_COLORS[tier], tier };
}
