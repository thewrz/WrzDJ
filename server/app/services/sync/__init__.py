"""Multi-service playlist sync package.

Auto-registers the Tidal adapter on import.
"""

from app.services.sync.registry import register_adapter
from app.services.sync.tidal_adapter import TidalSyncAdapter

# Auto-register built-in adapters
register_adapter(TidalSyncAdapter())
