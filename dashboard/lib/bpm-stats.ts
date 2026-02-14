/**
 * Robust BPM statistics with IQR-based outlier detection.
 *
 * DJs work within a BPM cluster — a set list at 128 BPM shouldn't have its
 * average dragged down by one 68 BPM hip-hop track. This module uses the
 * Interquartile Range method to identify outliers, exclude them from the
 * average, and flag them for neutral (gray) display.
 *
 * Half-time (0.5x) and double-time (2.0x) relationships are recognized —
 * a 64 BPM track in a 128 BPM set is compatible, not an outlier.
 */

export interface BpmContext {
  /** Robust average BPM (outliers excluded). Null if no data. */
  average: number | null;
  /** Returns true if a BPM value is an outlier relative to the cluster. */
  isOutlier: (bpm: number) => boolean;
}

const MINIMUM_FOR_IQR = 4;
const IQR_MULTIPLIER = 1.5;
const UNIFORM_FALLBACK_RANGE = 15;

/**
 * Normalize a BPM into the cluster's range by checking half/double-time.
 * Returns the variant closest to the median.
 */
function normalizeToCluster(bpm: number, median: number): number {
  const candidates = [bpm, bpm * 2, bpm / 2];
  let best = bpm;
  let bestDiff = Math.abs(bpm - median);
  for (const c of candidates) {
    const diff = Math.abs(c - median);
    if (diff < bestDiff) {
      best = c;
      bestDiff = diff;
    }
  }
  return best;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

/**
 * Compute robust BPM statistics from a list of BPM values.
 *
 * Uses IQR to detect outliers, normalizing half/double-time first.
 * Returns a context object with the outlier-excluded average and
 * an `isOutlier()` function for per-track checks.
 */
export function computeBpmContext(bpmValues: number[]): BpmContext {
  if (bpmValues.length === 0) {
    return { average: null, isOutlier: () => false };
  }

  if (bpmValues.length === 1) {
    return { average: bpmValues[0], isOutlier: () => false };
  }

  // Sort to find median for half/double-time normalization
  const sorted = [...bpmValues].sort((a, b) => a - b);
  const median = percentile(sorted, 50);

  // Normalize all values (half/double-time → cluster range)
  const normalized = bpmValues.map((b) => normalizeToCluster(b, median));
  const sortedNorm = [...normalized].sort((a, b) => a - b);

  // Not enough data for IQR — return simple average, no outlier detection
  if (sortedNorm.length < MINIMUM_FOR_IQR) {
    const avg = sortedNorm.reduce((s, v) => s + v, 0) / sortedNorm.length;
    return { average: avg, isOutlier: () => false };
  }

  const q1 = percentile(sortedNorm, 25);
  const q3 = percentile(sortedNorm, 75);
  const iqr = q3 - q1;

  // Bounds for non-outlier range
  let lowerBound: number;
  let upperBound: number;

  if (iqr === 0) {
    // Uniform BPMs — use fixed range around median
    lowerBound = median - UNIFORM_FALLBACK_RANGE;
    upperBound = median + UNIFORM_FALLBACK_RANGE;
  } else {
    lowerBound = q1 - IQR_MULTIPLIER * iqr;
    upperBound = q3 + IQR_MULTIPLIER * iqr;
  }

  // Compute average from non-outlier normalized values
  const inliers = sortedNorm.filter((v) => v >= lowerBound && v <= upperBound);
  const average = inliers.length > 0
    ? inliers.reduce((s, v) => s + v, 0) / inliers.length
    : sortedNorm.reduce((s, v) => s + v, 0) / sortedNorm.length;

  return {
    average,
    isOutlier: (bpm: number) => {
      const norm = normalizeToCluster(bpm, median);
      return norm < lowerBound || norm > upperBound;
    },
  };
}
