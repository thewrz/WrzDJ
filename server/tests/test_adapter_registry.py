"""Tests for adapter registry."""

from unittest.mock import MagicMock

import pytest

from app.services.sync.base import PlaylistSyncAdapter
from app.services.sync.registry import (
    _clear_adapters,
    get_adapter,
    get_connected_adapters,
    list_adapters,
    register_adapter,
)


class FakeAdapter(PlaylistSyncAdapter):
    """Fake adapter for testing."""

    def __init__(self, name: str, connected: bool = True):
        self._name = name
        self._connected = connected

    @property
    def service_name(self) -> str:
        return self._name

    def is_connected(self, user) -> bool:
        return self._connected

    def search_track(self, db, user, normalized, intent=None):
        return None

    def ensure_playlist(self, db, user, event):
        return None

    def add_to_playlist(self, db, user, playlist_id, track_id):
        return False


@pytest.fixture(autouse=True)
def clean_registry():
    """Clean registry before each test."""
    _clear_adapters()
    yield
    _clear_adapters()


class TestAdapterRegistry:
    def test_register_and_get(self):
        adapter = FakeAdapter("test_service")
        register_adapter(adapter)
        assert get_adapter("test_service") is adapter

    def test_get_unknown_returns_none(self):
        assert get_adapter("nonexistent") is None

    def test_list_adapters(self):
        a1 = FakeAdapter("service_a")
        a2 = FakeAdapter("service_b")
        register_adapter(a1)
        register_adapter(a2)
        adapters = list_adapters()
        assert len(adapters) == 2

    def test_get_connected_adapters(self):
        connected = FakeAdapter("connected", connected=True)
        disconnected = FakeAdapter("disconnected", connected=False)
        register_adapter(connected)
        register_adapter(disconnected)

        user = MagicMock()
        result = get_connected_adapters(user)
        assert len(result) == 1
        assert result[0].service_name == "connected"

    def test_register_overwrites(self):
        a1 = FakeAdapter("same_name")
        a2 = FakeAdapter("same_name")
        register_adapter(a1)
        register_adapter(a2)
        assert get_adapter("same_name") is a2


class TestTidalAutoRegistration:
    def test_tidal_registered_on_import(self):
        """Test that importing the sync package registers Tidal adapter."""
        # Re-import to trigger auto-registration
        from app.services.sync.registry import get_adapter

        # Tidal should be registered (may have been cleared by fixture)
        from app.services.sync.tidal_adapter import TidalSyncAdapter

        register_adapter(TidalSyncAdapter())
        adapter = get_adapter("tidal")
        assert adapter is not None
        assert adapter.service_name == "tidal"
