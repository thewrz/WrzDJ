"""In-memory command queue for bridge admin controls.

Commands are queued by DJs/admins and polled by the bridge on its next cycle.
Thread-safe via a lock since FastAPI runs sync endpoints on a thread pool.
"""

import threading
import uuid

from app.core.time import utcnow

# TTL in seconds — commands older than this are pruned on poll
_COMMAND_TTL_SECONDS = 60

# Thread-safe storage: {event_code: [{id, type, created_at}]}
_commands: dict[str, list[dict]] = {}
_lock = threading.Lock()


def queue_command(event_code: str, command_type: str) -> str:
    """Queue a command for the bridge to pick up.

    Returns the UUID command_id.
    """
    command_id = str(uuid.uuid4())
    entry = {
        "id": command_id,
        "type": command_type,
        "created_at": utcnow(),
    }
    with _lock:
        if event_code not in _commands:
            _commands[event_code] = []
        _commands[event_code].append(entry)
    return command_id


def poll_commands(event_code: str) -> list[dict]:
    """Return and atomically clear all pending commands for an event.

    Expired commands (older than TTL) are pruned before returning.
    """
    now = utcnow()
    with _lock:
        pending = _commands.pop(event_code, [])

    # Prune expired commands
    return [
        cmd for cmd in pending if (now - cmd["created_at"]).total_seconds() <= _COMMAND_TTL_SECONDS
    ]


def clear_all() -> None:
    """Clear the entire command store. Used for testing."""
    with _lock:
        _commands.clear()
