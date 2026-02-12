"""Filter unwanted track versions from search results.

Rejects tracks with unwanted version tags (sped up, karaoke, demo, etc.)
while being intent-aware — if the user explicitly asked for a version,
that version is allowed through.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.intent_parser import IntentContext

# Tags that indicate an unwanted version.
# Only matched in parenthetical/bracket/dash positions to avoid false positives.
UNWANTED_VERSION_TAGS = [
    "sped up",
    "speed up",
    "slowed",
    "slowed down",
    "slowed and reverb",
    "slowed + reverb",
    "reverb",
    "nightcore",
    "8d",
    "8d audio",
    "karaoke",
    "karaoke version",
    "demo",
    "demo version",
    "cover",
    "live",
    "live at",
    "live version",
    "live from",
    "tribute",
    "tribute to",
    "made famous by",
    "originally performed by",
    "in the style of",
]

# Pre-compiled patterns: match tags in parentheses, brackets, or after " - "
_TAG_PATTERNS: list[re.Pattern[str]] = []
for _tag in UNWANTED_VERSION_TAGS:
    _escaped = re.escape(_tag)
    # Match in (parentheses) or [brackets]
    _TAG_PATTERNS.append(re.compile(rf"[\(\[]\s*{_escaped}[^)\]]*[\)\]]", re.IGNORECASE))
    # Match after " - " at end of string
    _TAG_PATTERNS.append(re.compile(rf"\s+-\s+{_escaped}(?:\s|$)", re.IGNORECASE))


def is_unwanted_version(title: str | None, intent: IntentContext | None = None) -> bool:
    """Check if a track title contains unwanted version tags.

    Intent-aware:
    - intent=None -> apply default rejection rules
    - intent provided -> skip rejection for tags in intent.explicit_version_tags

    Only detects tags in parenthetical/bracket/dash positions, not in the base
    title itself. This prevents false positives like "Alive" or "Live Your Life".

    Args:
        title: The track title to check.
        intent: Optional parsed user intent.

    Returns:
        True if the title contains an unwanted version tag.
    """
    if not title:
        return False

    # Get the set of allowed tags from intent
    allowed_tags: set[str] = set()
    if intent and intent.explicit_version_tags:
        allowed_tags = {t.lower() for t in intent.explicit_version_tags}

    for tag, patterns in zip(UNWANTED_VERSION_TAGS, _tag_pattern_pairs(), strict=False):
        tag_lower = tag.lower()

        # Skip tags the user explicitly requested
        if tag_lower in allowed_tags:
            continue
        # Also skip if a parent tag is allowed (e.g., "slowed" allows "slowed and reverb")
        if any(tag_lower.startswith(at) for at in allowed_tags):
            continue

        for pattern in patterns:
            if pattern.search(title):
                return True

    return False


def _tag_pattern_pairs():
    """Yield pairs of (paren_pattern, dash_pattern) for each tag."""
    for i in range(0, len(_TAG_PATTERNS), 2):
        yield (_TAG_PATTERNS[i], _TAG_PATTERNS[i + 1])
