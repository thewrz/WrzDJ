"""In-memory pub/sub event bus for SSE real-time updates.

One bus per process. Channels are keyed by event_code.
Subscribers are asyncio.Queue instances.
"""

import asyncio
import logging
from collections import defaultdict
from typing import Any

logger = logging.getLogger(__name__)


class EventBus:
    """Process-local pub/sub for broadcasting events to SSE subscribers."""

    def __init__(self) -> None:
        self._channels: dict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)

    def subscribe(self, event_code: str) -> asyncio.Queue[dict[str, Any]]:
        """Subscribe to events for a given event code. Returns a Queue to read from."""
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=64)
        self._channels[event_code].add(queue)
        count = len(self._channels[event_code])
        logger.debug("SSE subscriber added for %s (total: %d)", event_code, count)
        return queue

    def unsubscribe(self, event_code: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        """Remove a subscriber."""
        self._channels[event_code].discard(queue)
        if not self._channels[event_code]:
            del self._channels[event_code]

    def publish(self, event_code: str, event_type: str, data: dict[str, Any] | None = None) -> None:
        """Publish an event to all subscribers of an event code.

        Non-blocking: drops messages for full queues (slow consumers).
        Safe to call from sync code via the module-level helper.
        """
        message = {"event": event_type, "data": data or {}}
        subscribers = self._channels.get(event_code, set())
        for queue in subscribers:
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                logger.warning("SSE queue full for %s, dropping %s event", event_code, event_type)

    def subscriber_count(self, event_code: str) -> int:
        """Return the number of active subscribers for an event code."""
        return len(self._channels.get(event_code, set()))


# Singleton instance
_bus = EventBus()


def get_event_bus() -> EventBus:
    """Get the singleton event bus instance."""
    return _bus


def publish_event(event_code: str, event_type: str, data: dict[str, Any] | None = None) -> None:
    """Convenience function to publish an event on the singleton bus."""
    _bus.publish(event_code, event_type, data)
