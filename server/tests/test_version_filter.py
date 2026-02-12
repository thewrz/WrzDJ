"""Tests for version filter — TDD style, tests written first."""

from app.services.intent_parser import IntentContext
from app.services.version_filter import is_unwanted_version


class TestUnwantedVersionNoIntent:
    """Tests with no intent (default rejection rules)."""

    def test_rejects_sped_up_paren(self):
        assert is_unwanted_version("Strobe (Sped Up)") is True

    def test_rejects_sped_up_bracket(self):
        assert is_unwanted_version("Strobe [Sped Up]") is True

    def test_rejects_slowed_and_reverb(self):
        assert is_unwanted_version("Blinding Lights (Slowed and Reverb)") is True

    def test_rejects_karaoke(self):
        assert is_unwanted_version("Bohemian Rhapsody (Karaoke Version)") is True

    def test_rejects_demo(self):
        assert is_unwanted_version("In Utero (Demo)") is True

    def test_rejects_cover(self):
        assert is_unwanted_version("Hallelujah (Cover)") is True

    def test_rejects_live(self):
        assert is_unwanted_version("Alive (Live)") is True

    def test_rejects_live_at(self):
        assert is_unwanted_version("One More Time (Live at Coachella)") is True

    def test_rejects_nightcore(self):
        assert is_unwanted_version("Angel (Nightcore)") is True

    def test_rejects_8d(self):
        assert is_unwanted_version("Blinding Lights (8D Audio)") is True

    def test_rejects_tribute(self):
        assert is_unwanted_version("Bohemian Rhapsody (Tribute to Queen)") is True

    def test_rejects_dash_live(self):
        assert is_unwanted_version("One More Time - Live") is True

    def test_rejects_dash_demo(self):
        assert is_unwanted_version("Creep - Demo Version") is True


class TestUnwantedVersionKeeps:
    """Tests for titles that should NOT be rejected."""

    def test_keeps_plain_title(self):
        assert is_unwanted_version("Strobe") is False

    def test_keeps_named_remix(self):
        assert is_unwanted_version("Strobe (Maceo Plex Remix)") is False

    def test_keeps_remaster(self):
        assert is_unwanted_version("Bohemian Rhapsody (2011 Remaster)") is False

    def test_keeps_original_mix(self):
        assert is_unwanted_version("Strobe (Original Mix)") is False

    def test_keeps_extended_mix(self):
        assert is_unwanted_version("Strobe (Extended Mix)") is False

    def test_keeps_empty_title(self):
        assert is_unwanted_version("") is False

    def test_keeps_none_title(self):
        assert is_unwanted_version(None) is False


class TestFalsePositiveGuards:
    """Ensure common false positives are NOT flagged."""

    def test_alive_not_flagged(self):
        """'Alive' should not be flagged as 'live'."""
        assert is_unwanted_version("Alive") is False

    def test_live_your_life_not_flagged(self):
        """'Live Your Life' should not be flagged."""
        assert is_unwanted_version("Live Your Life") is False

    def test_deliver_not_flagged(self):
        """'Deliver' should not be flagged as 'live'."""
        assert is_unwanted_version("Deliver") is False

    def test_live_in_base_title_not_flagged(self):
        """'live' in the base title (not parenthetical) is fine."""
        assert is_unwanted_version("Live and Let Die") is False

    def test_discovered_not_flagged(self):
        """'Discovered' should not be flagged as 'cover'."""
        assert is_unwanted_version("Discovered") is False

    def test_demon_not_flagged(self):
        """'Demon' should not be flagged as 'demo'."""
        assert is_unwanted_version("Demon Days") is False

    def test_covered_in_base_not_flagged(self):
        """'Covered' in base title should not be flagged."""
        assert is_unwanted_version("Covered in Rain") is False


class TestIntentAwareFiltering:
    """Tests with explicit intent — versions user asked for are allowed."""

    def test_sped_up_allowed_when_requested(self):
        intent = IntentContext(
            raw_query="Strobe sped up",
            explicit_version_tags=["sped up"],
            wants_original=False,
        )
        assert is_unwanted_version("Strobe (Sped Up)", intent) is False

    def test_live_allowed_when_requested(self):
        intent = IntentContext(
            raw_query="Daft Punk Alive live",
            explicit_version_tags=["live"],
            wants_original=False,
        )
        assert is_unwanted_version("Alive (Live at Coachella)", intent) is False

    def test_acoustic_allowed_when_requested(self):
        intent = IntentContext(
            raw_query="Creep acoustic",
            explicit_version_tags=["acoustic"],
            wants_original=False,
        )
        # acoustic is not in UNWANTED_VERSION_TAGS, so it's not rejected anyway
        assert is_unwanted_version("Creep (Acoustic)", intent) is False

    def test_other_versions_still_rejected(self):
        """When user asks for 'sped up', karaoke versions are still rejected."""
        intent = IntentContext(
            raw_query="Strobe sped up",
            explicit_version_tags=["sped up"],
            wants_original=False,
        )
        assert is_unwanted_version("Strobe (Karaoke Version)", intent) is True

    def test_slowed_allows_slowed_and_reverb(self):
        """When user asks for 'slowed', 'slowed and reverb' should also be allowed."""
        intent = IntentContext(
            raw_query="Blinding Lights slowed",
            explicit_version_tags=["slowed"],
            wants_original=False,
        )
        assert is_unwanted_version("Blinding Lights (Slowed and Reverb)", intent) is False
