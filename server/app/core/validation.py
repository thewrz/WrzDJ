"""Input validation and sanitization utilities."""

import re
import unicodedata

from better_profanity import profanity

# Control characters to remove (except newline, tab)
CONTROL_CHAR_PATTERN = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

# Multiple whitespace pattern
MULTI_WHITESPACE_PATTERN = re.compile(r"\s+")


def normalize_text(text: str | None) -> str | None:
    """
    Normalize text input by:
    - Stripping leading/trailing whitespace
    - Collapsing multiple whitespace to single space
    - Removing null bytes and control characters
    - Normalizing Unicode to NFC form

    Returns None if input is None.
    """
    if text is None:
        return None

    # Normalize Unicode to NFC (canonical composition)
    text = unicodedata.normalize("NFC", text)

    # Remove control characters (except newline, tab for notes)
    text = CONTROL_CHAR_PATTERN.sub("", text)

    # Strip leading/trailing whitespace
    text = text.strip()

    # Collapse multiple whitespace to single space
    text = MULTI_WHITESPACE_PATTERN.sub(" ", text)

    return text


def normalize_single_line(text: str | None) -> str | None:
    """
    Normalize text for single-line fields (no newlines allowed).
    """
    if text is None:
        return None

    # Remove all newlines
    text = text.replace("\n", " ").replace("\r", " ")

    return normalize_text(text)


def is_safe_string(text: str) -> bool:
    """
    Check if a string is safe (no control characters, null bytes).
    """
    if not text:
        return True
    return CONTROL_CHAR_PATTERN.search(text) is None


def validate_event_code(code: str) -> bool:
    """
    Validate an event code format.
    Must be exactly 6 alphanumeric characters.
    """
    if not code:
        return False
    return bool(re.match(r"^[A-Z0-9]{6}$", code))


def validate_length(text: str | None, min_len: int = 0, max_len: int = 255) -> bool:
    """
    Validate that text length is within bounds.
    """
    if text is None:
        return min_len == 0
    length = len(text)
    return min_len <= length <= max_len


profanity.load_censor_words()

_LEET_MAP = str.maketrans(
    {"@": "a", "$": "s", "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t"}
)

_BLOCKED_SUBSTRINGS = frozenset(
    {
        "fuck",
        "shit",
        "dick",
        "cock",
        "cunt",
        "pussy",
        "penis",
        "bitch",
        "nigger",
        "nigga",
        "faggot",
        "whore",
        "slut",
        "twat",
        "asshole",
        "wank",
        "tits",
        "dildo",
        "jizz",
        "retard",
        "poop",
        "shart",
        "fart",
        "turd",
    }
)

_NON_ALPHA_RE = re.compile(r"[^a-z]")


def _distinct_ordered_alpha(text: str) -> str:
    """Extract each unique lowercase letter exactly once, in first-occurrence
    order.  'mmShmmImmT' -> 'mshit'.  Used to detect letter-padding bypasses
    where a blocked word's letters are separated by repeated filler characters
    (e.g. 'mmSmmHmmImmT' to spell out 'shit' with 'mm' padding)."""
    seen: set[str] = set()
    out: list[str] = []
    for c in text:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return _NON_ALPHA_RE.sub("", "".join(out))


def contains_profanity(text: str) -> bool:
    """Check text for profanity using word-boundary matching and substring
    matching with leetspeak normalization.  Designed for username-style input
    where words are concatenated without spaces.

    Detection layers:
    1. better_profanity word-boundary check (catches common phrases).
    2. Substring check on alpha-only normalized text (catches dots/numbers
       used as separators, e.g. 's.h.i.t' or 'sh1t').
    3. Distinct-letter skeleton check (catches alpha letter padding,
       e.g. 'mmSmmHmmImmT' -> 'mshit' contains 'shit').
    """
    if not text:
        return False
    if profanity.contains_profanity(text):
        return True
    normalized = text.lower().translate(_LEET_MAP)
    alpha_only = _NON_ALPHA_RE.sub("", normalized)
    if any(word in alpha_only for word in _BLOCKED_SUBSTRINGS):
        return True
    distinct_alpha = _distinct_ordered_alpha(normalized)
    return any(word in distinct_alpha for word in _BLOCKED_SUBSTRINGS)
