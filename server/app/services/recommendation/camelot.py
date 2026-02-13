"""Camelot wheel key parsing and harmonic compatibility scoring.

The Camelot wheel maps musical keys to a numbered circle (1-12) with
inner (A = minor) and outer (B = major) rings. Adjacent positions
on the wheel are harmonically compatible.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class CamelotPosition:
    """Position on the Camelot wheel."""

    number: int  # 1-12
    letter: str  # "A" (minor) or "B" (major)

    def __str__(self) -> str:
        return f"{self.number}{self.letter}"


# Map of all common key representations to Camelot positions.
# Covers: "C major", "C maj", "Cmaj", "CM", "C", standard notation,
# Camelot codes "8B", sharps/flats, enharmonic equivalents.
CAMELOT_MAP: dict[str, CamelotPosition] = {}

# Standard key -> Camelot mapping
_KEY_DEFINITIONS: list[tuple[int, str, list[str]]] = [
    # (camelot_number, letter, [key_names])
    # Minor keys (A ring)
    (1, "A", ["A-flat minor", "Ab minor", "Ab min", "Abm", "G# minor", "G#m", "G# min"]),
    (2, "A", ["E-flat minor", "Eb minor", "Eb min", "Ebm", "D# minor", "D#m", "D# min"]),
    (3, "A", ["B-flat minor", "Bb minor", "Bb min", "Bbm", "A# minor", "A#m", "A# min"]),
    (4, "A", ["F minor", "F min", "Fm"]),
    (5, "A", ["C minor", "C min", "Cm"]),
    (6, "A", ["G minor", "G min", "Gm"]),
    (7, "A", ["D minor", "D min", "Dm"]),
    (8, "A", ["A minor", "A min", "Am"]),
    (9, "A", ["E minor", "E min", "Em"]),
    (10, "A", ["B minor", "B min", "Bm"]),
    (11, "A", ["F-sharp minor", "F# minor", "F# min", "F#m", "Gb minor", "Gbm", "Gb min"]),
    (12, "A", ["D-flat minor", "Db minor", "Db min", "Dbm", "C# minor", "C#m", "C# min"]),
    # Major keys (B ring)
    # Note: Do NOT include "BM", "FM", etc. — lowercased they collide with
    # minor abbreviations ("bm" = B minor, "fm" = F minor). Use "Bmaj" instead.
    (1, "B", ["B major", "B maj", "Bmaj"]),
    (2, "B", ["F-sharp major", "F# major", "F# maj", "F#maj", "Gb major", "Gbmaj", "Gb maj"]),
    (3, "B", ["D-flat major", "Db major", "Db maj", "Dbmaj", "C# major", "C#maj", "C# maj"]),
    (4, "B", ["A-flat major", "Ab major", "Ab maj", "Abmaj", "G# major", "G#maj", "G# maj"]),
    (5, "B", ["E-flat major", "Eb major", "Eb maj", "Ebmaj", "D# major", "D#maj", "D# maj"]),
    (6, "B", ["B-flat major", "Bb major", "Bb maj", "Bbmaj", "A# major", "A#maj", "A# maj"]),
    (7, "B", ["F major", "F maj", "Fmaj"]),
    (8, "B", ["C major", "C maj", "Cmaj"]),
    (9, "B", ["G major", "G maj", "Gmaj"]),
    (10, "B", ["D major", "D maj", "Dmaj"]),
    (11, "B", ["A major", "A maj", "Amaj"]),
    (12, "B", ["E major", "E maj", "Emaj"]),
]

# Build the map
for _num, _letter, _names in _KEY_DEFINITIONS:
    pos = CamelotPosition(number=_num, letter=_letter)
    # Add Camelot code itself (e.g. "8A", "8B")
    CAMELOT_MAP[f"{_num}{_letter}"] = pos
    CAMELOT_MAP[f"{_num}{_letter.lower()}"] = pos
    for name in _names:
        CAMELOT_MAP[name.lower()] = pos

# Clean up module namespace
del _num, _letter, _names, pos


def parse_key(key_str: str | None) -> CamelotPosition | None:
    """Parse a musical key string into a Camelot wheel position.

    Handles formats: "A minor", "Am", "A min", "8A", "C maj",
    Beatport/Tidal key strings, and Camelot codes.

    Returns None for unrecognizable or empty input.
    """
    if not key_str or not key_str.strip():
        return None

    normalized = key_str.strip().lower()

    # Direct lookup
    result = CAMELOT_MAP.get(normalized)
    if result:
        return result

    # Try without extra whitespace
    compressed = " ".join(normalized.split())
    result = CAMELOT_MAP.get(compressed)
    if result:
        return result

    # Try matching just the Camelot code pattern (e.g. "8A" or "12B")
    stripped = normalized.replace(" ", "")
    if len(stripped) >= 2 and stripped[-1] in ("a", "b"):
        num_part = stripped[:-1]
        if num_part.isdigit():
            num = int(num_part)
            if 1 <= num <= 12:
                return CamelotPosition(number=num, letter=stripped[-1].upper())

    return None


def compatibility_score(a: CamelotPosition | None, b: CamelotPosition | None) -> float:
    """Score harmonic compatibility between two Camelot positions.

    Returns:
        1.0 — same key (perfect match)
        0.8 — adjacent on wheel (+/-1) or parallel (A<->B at same position)
        0.5 — two positions away
        0.0 — incompatible or either key is None
    """
    if a is None or b is None:
        return 0.0

    if a == b:
        return 1.0

    # Parallel key (same number, different letter)
    if a.number == b.number and a.letter != b.letter:
        return 0.8

    # Adjacent on the wheel (same letter, +/-1 with wrap-around)
    if a.letter == b.letter:
        diff = abs(a.number - b.number)
        # Handle wrap-around: 12 -> 1 is distance 1
        circular_diff = min(diff, 12 - diff)
        if circular_diff == 1:
            return 0.8
        if circular_diff == 2:
            return 0.5

    return 0.0
