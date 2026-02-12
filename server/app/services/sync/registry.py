"""Adapter registry — central lookup for playlist sync adapters."""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.services.sync.base import PlaylistSyncAdapter

if TYPE_CHECKING:
    from app.models.user import User

_adapters: dict[str, PlaylistSyncAdapter] = {}


def register_adapter(adapter: PlaylistSyncAdapter) -> None:
    """Register a sync adapter by its service name."""
    _adapters[adapter.service_name] = adapter


def get_adapter(name: str) -> PlaylistSyncAdapter | None:
    """Get a registered adapter by name."""
    return _adapters.get(name)


def get_connected_adapters(user: User) -> list[PlaylistSyncAdapter]:
    """Get all adapters where the user has an active connection."""
    return [a for a in _adapters.values() if a.is_connected(user)]


def list_adapters() -> list[PlaylistSyncAdapter]:
    """Get all registered adapters."""
    return list(_adapters.values())


def _clear_adapters() -> None:
    """Clear all registered adapters (for testing only)."""
    _adapters.clear()
