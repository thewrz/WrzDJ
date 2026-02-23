"""SSE streaming endpoint for real-time event updates (no authentication required)."""

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from app.services.event_bus import get_event_bus

logger = logging.getLogger(__name__)
router = APIRouter()

KEEPALIVE_INTERVAL = 15  # seconds


async def _event_generator(
    request: Request,
    event_code: str,
) -> Any:
    """Yield SSE events for a given event code until the client disconnects."""
    bus = get_event_bus()
    queue = bus.subscribe(event_code)
    try:
        while True:
            if await request.is_disconnected():
                break
            try:
                message = await asyncio.wait_for(queue.get(), timeout=KEEPALIVE_INTERVAL)
                yield {
                    "event": message["event"],
                    "data": json.dumps(message["data"]),
                }
            except TimeoutError:
                # Send keepalive comment to prevent proxy/browser timeouts
                yield {"comment": "keepalive"}
    finally:
        bus.unsubscribe(event_code, queue)


@router.get("/events/{code}/stream")
async def event_stream(code: str, request: Request) -> EventSourceResponse:
    """Public SSE endpoint for real-time event updates.

    Event types:
    - request_created: New request submitted
    - request_status_changed: Request status update
    - now_playing_changed: Now-playing track update
    - requests_bulk_update: Batch accept/reject
    - bridge_status_changed: Bridge connect/disconnect
    """
    return EventSourceResponse(
        _event_generator(request, code),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no"},
    )
