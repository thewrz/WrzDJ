"""Multi-service playlist sync package.

Auto-registers all built-in adapters on import.
"""

from app.services.sync.beatport_adapter import BeatportSyncAdapter
from app.services.sync.registry import register_adapter
from app.services.sync.tidal_adapter import TidalSyncAdapter

# Auto-register built-in adapters
register_adapter(TidalSyncAdapter())
register_adapter(BeatportSyncAdapter())
