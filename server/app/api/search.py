from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_current_admin, get_db
from app.core.config import get_settings
from app.core.rate_limit import limiter
from app.models.search_cache import SearchCache
from app.models.user import User
from app.schemas.common import CacheClearResponse
from app.schemas.search import SearchResult
from app.services.search_merge import tidal_to_search_result
from app.services.spotify import search_songs
from app.services.system_settings import get_system_settings

router = APIRouter()
settings = get_settings()


@router.get("", response_model=list[SearchResult])
@limiter.limit(lambda: f"{settings.search_rate_limit_per_minute}/minute")
def search(
    request: Request,
    q: str = Query(..., min_length=2, max_length=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> list[SearchResult]:
    from app.services.tidal import search_tidal_tracks

    sys_settings = get_system_settings(db)

    # Search Spotify if enabled
    results = []
    if sys_settings.spotify_enabled:
        results = search_songs(db, q)

    # Tidal fallback when Spotify returns nothing and user has Tidal linked
    if not results and current_user.tidal_access_token:
        tidal_results = search_tidal_tracks(db, current_user, q, limit=20)
        results = [tidal_to_search_result(t) for t in tidal_results]

    if not sys_settings.spotify_enabled and not current_user.tidal_access_token:
        raise HTTPException(status_code=503, detail="Song search is currently unavailable")

    return results


@router.delete("/cache", response_model=CacheClearResponse)
def clear_search_cache(
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> CacheClearResponse:
    """Clear all cached search results (admin only)."""
    count = db.query(SearchCache).delete()
    db.commit()
    return CacheClearResponse(message=f"Cleared {count} cached search results")
