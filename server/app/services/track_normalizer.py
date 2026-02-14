"""Track title and artist normalization for fuzzy matching.

Extracted from now_playing.py — provides the normalization utilities
used by the sync pipeline, fuzzy matching, and version filtering.
"""

import re
import statistics
from dataclasses import dataclass
from difflib import SequenceMatcher

# Generic mix suffixes that guests almost never include in requests.
# These get stripped before fuzzy comparison so "Banana (Original Mix)" matches "Banana".
# Named remixes, Instrumental, Acoustic, Live, VIP, Dub Mix, A Cappella are preserved.
_GENERIC_SUFFIXES = (
    r"original\s+mix|extended\s+mix|radio\s+edit|club\s+mix|"
    r"album\s+version|single\s+version|full\s+length(?:\s+version)?|"
    r"main\s+mix|short\s+(?:edit|mix)|long\s+(?:mix|version)|"
    r"original\s+version|original|extended"
)
GENERIC_SUFFIX_PAREN_RE = re.compile(
    rf"\s*[\(\[]\s*(?:{_GENERIC_SUFFIXES})\s*[\)\]]\s*", re.IGNORECASE
)
GENERIC_SUFFIX_DASH_RE = re.compile(rf"\s+-\s+(?:{_GENERIC_SUFFIXES})\s*$", re.IGNORECASE)
FEAT_RE = re.compile(r"\b(?:featuring|feat\.?|ft\.?|with)(?=\s)", re.IGNORECASE)
MULTI_SPACE_RE = re.compile(r"\s{2,}")

# Remix detection: "Artist Remix", "Artist Edit", etc. in parentheses or after dash
_REMIX_PAREN_RE = re.compile(
    r"[\(\[]([\w\s&.]+?)\s+(remix|edit|bootleg|rework|flip|mix)\s*[\)\]]",
    re.IGNORECASE,
)
_REMIX_DASH_RE = re.compile(
    r"\s+-\s+([\w\s&.]+?)\s+(remix|edit|bootleg|rework|flip)\s*$",
    re.IGNORECASE,
)


def normalize_track_title(title: str) -> str:
    """Normalize a track title for fuzzy matching.

    Strips generic mix suffixes (Original Mix, Extended Mix, Radio Edit, etc.)
    but preserves named remixes (e.g. "Skrillex Remix"), special versions
    (Instrumental, Acoustic, Live, VIP, Dub Mix, A Cappella), and arbitrary
    parenthetical content (e.g. "2024 Remaster").
    """
    result = GENERIC_SUFFIX_PAREN_RE.sub("", title)
    result = GENERIC_SUFFIX_DASH_RE.sub("", result)
    result = MULTI_SPACE_RE.sub(" ", result).strip()
    return result


def normalize_artist(artist: str) -> str:
    """Normalize artist name for fuzzy matching.

    Canonicalizes feat/ft/featuring/with -> "feat." so that
    "Artist feat. Singer" matches "Artist featuring Singer".
    """
    result = FEAT_RE.sub("feat.", artist)
    result = MULTI_SPACE_RE.sub(" ", result).strip()
    return result


def fuzzy_match_score(a: str, b: str) -> float:
    """Compute similarity ratio between two strings (0.0 to 1.0)."""
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


# Splitting pattern: comma, ampersand, "and", "x" (collab), feat variants
_SPLIT_RE = re.compile(
    r"\s*,\s*"  # comma
    r"|\s+&\s+"  # ampersand
    r"|\s+and\s+"  # "and" keyword
    r"|\s+x\s+"  # "x" collab
    r"|\s+(?:featuring|feat\.?|ft\.?|with)\s+",  # feat variants
    re.IGNORECASE,
)


def split_artists(artist: str) -> list[str]:
    """Split a composite artist string into individual artist names.

    Handles comma, ampersand, "and", "x" (collab), and feat/ft/featuring/with
    delimiters. Returns at least one element. Strips whitespace and filters
    empty segments.
    """
    parts = _SPLIT_RE.split(artist)
    result = [p.strip() for p in parts if p.strip()]
    return result if result else [artist.strip()]


def artist_match_score(a: str, b: str) -> float:
    """Multi-artist-aware similarity score (0.0 to 1.0).

    Splits both strings via split_artists(), then computes the maximum
    pairwise fuzzy_match_score. Also checks full normalized strings
    for exact-match edge cases (e.g., "Above & Beyond" vs "Above & Beyond").
    """
    # Fast path: full normalized match
    full_score = fuzzy_match_score(a, b)
    if full_score >= 0.95:
        return full_score

    parts_a = split_artists(a)
    parts_b = split_artists(b)

    best = 0.0
    for pa in parts_a:
        for pb in parts_b:
            score = fuzzy_match_score(pa, pb)
            if score > best:
                best = score
                if best >= 0.99:
                    return best
    return max(best, full_score)


def primary_artist(artist: str) -> str:
    """Return the first/primary artist from a composite artist string.

    Used to build search queries — multi-artist strings produce overly
    specific queries that miss results.
    """
    return split_artists(artist)[0]


def normalize_bpm_to_context(bpm: float, context_bpms: list[float]) -> float:
    """Correct half-time or double-time BPM using event context.

    Checks if bpm, bpm*2, or bpm/2 is closer to the median of context_bpms.
    Conservative: only corrects when raw is >30% away from median AND the
    corrected value is <15% away. Requires >= 3 context values.
    """
    if bpm <= 0 or len(context_bpms) < 3:
        return bpm

    median = statistics.median(context_bpms)
    if median <= 0:
        return bpm

    raw_distance = abs(bpm - median) / median

    # If raw is already within 30%, don't correct
    if raw_distance <= 0.30:
        return bpm

    # Check doubled and halved candidates
    candidates = [bpm * 2, bpm / 2]
    for candidate in candidates:
        candidate_distance = abs(candidate - median) / median
        if candidate_distance < 0.15:
            return candidate

    return bpm


@dataclass(frozen=True)
class NormalizedTrack:
    """A track with both raw and normalized title/artist.

    Used by the sync pipeline to compare search results against requests.
    """

    title: str  # Normalized (generic suffixes stripped)
    artist: str  # Normalized (feat. canonicalized)
    raw_title: str  # Original before normalization
    raw_artist: str  # Original before normalization
    remix_artist: str | None = None
    remix_type: str | None = None  # "remix", "edit", "bootleg"
    has_named_remix: bool = False


def normalize_track(title: str, artist: str) -> NormalizedTrack:
    """Normalize a track's title and artist for comparison.

    Detects named remixes in parenthetical or dash-separated positions,
    normalizes the title and artist, and returns a NormalizedTrack.

    Args:
        title: Raw track title (e.g., "Strobe (Maceo Plex Remix)")
        artist: Raw artist name (e.g., "deadmau5 feat. Kaskade")

    Returns:
        NormalizedTrack with normalized and raw fields.
    """
    # Detect named remix from title
    remix_artist: str | None = None
    remix_type: str | None = None

    remix_match = _REMIX_PAREN_RE.search(title) or _REMIX_DASH_RE.search(title)
    if remix_match:
        remix_artist = remix_match.group(1).strip()
        remix_type = remix_match.group(2).lower()

    return NormalizedTrack(
        title=normalize_track_title(title),
        artist=normalize_artist(artist),
        raw_title=title,
        raw_artist=artist,
        remix_artist=remix_artist,
        remix_type=remix_type,
        has_named_remix=remix_artist is not None,
    )
