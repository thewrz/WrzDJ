"""Parse user search intent from raw query strings.

Detects explicit version tags (e.g., 'sped up', 'live', 'acoustic'),
remix artists, and determines whether the user wants a specific version
or the original track.
"""

import re
from dataclasses import dataclass, field

# Version keywords (normalized to lowercase for matching)
_VERSION_TAGS = [
    "sped up",
    "slowed",
    "slowed and reverb",
    "slowed + reverb",
    "reverb",
    "nightcore",
    "8d",
    "8d audio",
    "acoustic",
    "live",
    "instrumental",
    "karaoke",
    "demo",
    "a cappella",
    "acapella",
    "vip",
    "dub mix",
    "dub",
]

# Remix/edit/bootleg keywords. Captures last 1-2 words before keyword as artist.
# Most DJ names are 1-2 words (e.g., "Maceo Plex", "DJ Snake", "Skrillex").
_REMIX_TYPES = ("remix", "edit", "bootleg", "rework", "flip")


def _detect_trailing_remix(raw_query: str) -> tuple[str | None, bool]:
    """Linear-time detection of trailing remix keyword + preceding artist.

    Replaces a backtracking regex to eliminate polynomial ReDoS risk.
    """
    tokens = raw_query.strip().split()
    if len(tokens) < 2:
        return None, False
    if tokens[-1].lower() not in _REMIX_TYPES:
        return None, False
    preceding = tokens[:-1]
    artist = " ".join(preceding[-2:]) if len(preceding) >= 2 else preceding[-1]
    return artist, True


@dataclass(frozen=True)
class IntentContext:
    """Parsed intent from a user's raw search query."""

    raw_query: str
    explicit_version_tags: list[str] = field(default_factory=list)
    explicit_remix_artist: str | None = None
    wants_remix: bool = False
    wants_original: bool = True


def parse_intent(raw_query: str) -> IntentContext:
    """Parse intent from a raw search query.

    Scans for version keywords and remix patterns to determine
    what version of a track the user is looking for.

    Args:
        raw_query: The user's original search string.

    Returns:
        IntentContext with parsed intent information.
    """
    if not raw_query or not raw_query.strip():
        return IntentContext(raw_query=raw_query or "")

    query_lower = raw_query.lower().strip()

    # Detect explicit version tags
    found_tags: list[str] = []
    for tag in _VERSION_TAGS:
        # Match tag as a word boundary or in parentheses/brackets
        # Use word-boundary-safe matching for multi-word tags
        escaped = re.escape(tag)
        if re.search(rf"(?:^|\s|\(|\[){escaped}(?:\s|\)|\]|$)", query_lower):
            found_tags.append(tag)

    # Detect remix patterns
    remix_artist, wants_remix = _detect_trailing_remix(raw_query)

    if not wants_remix:
        # Check for bare "remix"/"edit"/"bootleg" anywhere in the query
        for rtype in _REMIX_TYPES:
            if re.search(rf"\b{rtype}\b", query_lower):
                wants_remix = True
                break

    wants_original = not wants_remix and len(found_tags) == 0

    return IntentContext(
        raw_query=raw_query,
        explicit_version_tags=found_tags,
        explicit_remix_artist=remix_artist,
        wants_remix=wants_remix,
        wants_original=wants_original,
    )
