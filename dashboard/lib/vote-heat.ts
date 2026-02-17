/**
 * Computes visual "heat" styling for request cards based on vote count.
 * Higher vote counts produce warmer background tints and border accents,
 * helping DJs instantly spot crowd favorites.
 */

interface VoteHeatStyle {
  background?: string;
  borderColor?: string;
}

export function getVoteHeatStyle(voteCount: number): VoteHeatStyle {
  if (voteCount <= 0) return {};
  if (voteCount <= 2) return { background: 'rgba(251, 191, 36, 0.04)' };
  if (voteCount <= 4)
    return { background: 'rgba(251, 191, 36, 0.08)', borderColor: '#f59e0b33' };
  if (voteCount <= 9)
    return { background: 'rgba(251, 191, 36, 0.12)', borderColor: '#f59e0b66' };
  return { background: 'rgba(251, 191, 36, 0.18)', borderColor: '#f59e0b' };
}

export function getVoteHeatClass(voteCount: number): string {
  if (voteCount <= 0) return 'vote-heat-0';
  if (voteCount <= 2) return 'vote-heat-low';
  if (voteCount <= 4) return 'vote-heat-med';
  if (voteCount <= 9) return 'vote-heat-high';
  return 'vote-heat-hot';
}
