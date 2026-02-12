"""Tests for intent parser — TDD style, tests written first."""

from app.services.intent_parser import parse_intent


class TestParseIntentBasic:
    """Basic intent parsing tests."""

    def test_empty_query(self):
        result = parse_intent("")
        assert result.raw_query == ""
        assert result.wants_original is True
        assert result.wants_remix is False
        assert result.explicit_version_tags == []

    def test_none_query(self):
        result = parse_intent(None)
        assert result.raw_query == ""
        assert result.wants_original is True

    def test_plain_query(self):
        result = parse_intent("deadmau5 Strobe")
        assert result.wants_original is True
        assert result.wants_remix is False
        assert result.explicit_version_tags == []
        assert result.explicit_remix_artist is None

    def test_whitespace_only(self):
        result = parse_intent("   ")
        assert result.wants_original is True


class TestParseIntentVersionTags:
    """Tests for version tag detection."""

    def test_sped_up(self):
        result = parse_intent("deadmau5 Strobe sped up")
        assert "sped up" in result.explicit_version_tags
        assert result.wants_original is False

    def test_slowed_and_reverb(self):
        result = parse_intent("The Weeknd Blinding Lights slowed and reverb")
        assert "slowed and reverb" in result.explicit_version_tags
        assert result.wants_original is False

    def test_acoustic(self):
        result = parse_intent("Radiohead Creep acoustic")
        assert "acoustic" in result.explicit_version_tags
        assert result.wants_original is False

    def test_live(self):
        result = parse_intent("Daft Punk Alive live")
        assert "live" in result.explicit_version_tags
        assert result.wants_original is False

    def test_instrumental(self):
        result = parse_intent("Eminem Lose Yourself instrumental")
        assert "instrumental" in result.explicit_version_tags
        assert result.wants_original is False

    def test_karaoke(self):
        result = parse_intent("Queen Bohemian Rhapsody karaoke")
        assert "karaoke" in result.explicit_version_tags
        assert result.wants_original is False

    def test_nightcore(self):
        result = parse_intent("Angel nightcore")
        assert "nightcore" in result.explicit_version_tags
        assert result.wants_original is False

    def test_8d_audio(self):
        result = parse_intent("Tame Impala The Less I Know 8d audio")
        assert "8d audio" in result.explicit_version_tags
        assert result.wants_original is False

    def test_demo(self):
        result = parse_intent("Nirvana In Utero demo")
        assert "demo" in result.explicit_version_tags
        assert result.wants_original is False

    def test_tag_in_parentheses(self):
        result = parse_intent("deadmau5 Strobe (sped up)")
        assert "sped up" in result.explicit_version_tags

    def test_tag_in_brackets(self):
        result = parse_intent("deadmau5 Strobe [live]")
        assert "live" in result.explicit_version_tags

    def test_multiple_tags(self):
        result = parse_intent("The Weeknd Blinding Lights slowed reverb")
        assert "slowed" in result.explicit_version_tags
        assert "reverb" in result.explicit_version_tags

    def test_vip_version(self):
        result = parse_intent("Skrillex Scary Monsters VIP")
        assert "vip" in result.explicit_version_tags
        assert result.wants_original is False


class TestParseIntentRemix:
    """Tests for remix detection."""

    def test_named_remix(self):
        result = parse_intent("deadmau5 Strobe Maceo Plex remix")
        assert result.wants_remix is True
        assert result.wants_original is False
        assert result.explicit_remix_artist == "Maceo Plex"

    def test_named_edit(self):
        result = parse_intent("Fisher Losing It Patrick Topping edit")
        assert result.wants_remix is True
        assert result.explicit_remix_artist == "Patrick Topping"

    def test_named_bootleg(self):
        result = parse_intent("Daft Punk One More Time DJ Snake bootleg")
        assert result.wants_remix is True
        assert result.explicit_remix_artist == "DJ Snake"

    def test_bare_remix(self):
        result = parse_intent("deadmau5 Strobe remix")
        assert result.wants_remix is True
        # "remix" alone might not extract a clean artist name
        # but wants_remix should be True

    def test_bare_edit(self):
        result = parse_intent("Strobe edit")
        assert result.wants_remix is True

    def test_bare_bootleg(self):
        result = parse_intent("Strobe bootleg")
        assert result.wants_remix is True


class TestParseIntentImmutability:
    """Tests that IntentContext is immutable (frozen dataclass)."""

    def test_frozen(self):
        result = parse_intent("deadmau5 Strobe")
        try:
            result.wants_original = False
            assert False, "Should not be able to mutate frozen dataclass"
        except AttributeError:
            pass
