"""Track title and artist normalization for fuzzy matching.

Extracted from now_playing.py — provides the normalization utilities
used by the sync pipeline, fuzzy matching, and version filtering.
"""

import re
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
