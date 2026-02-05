"""Input validation and sanitization utilities."""

import re
import unicodedata

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
