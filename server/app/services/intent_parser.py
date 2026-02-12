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

# Remix/edit/bootleg pattern: "Artist Remix", "Artist Edit", "Artist Bootleg"
# Captures the last 1-2 words before the remix type keyword.
# Most DJ names are 1-2 words (e.g., "Maceo Plex", "DJ Snake", "Skrillex").
_REMIX_TYPES = ("remix", "edit", "bootleg", "rework", "flip")
_REMIX_ARTIST_PATTERN = re.compile(
    r"(\S+(?:\s+\S+)?)\s+(remix|edit|bootleg|rework|flip)\s*$",
    re.IGNORECASE,
)


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
    remix_match = _REMIX_ARTIST_PATTERN.search(raw_query)
    remix_artist: str | None = None
    wants_remix = False

    if remix_match:
        remix_artist = remix_match.group(1).strip()
        wants_remix = True
    else:
        # Check for bare "remix"/"edit"/"bootleg" without artist name
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
