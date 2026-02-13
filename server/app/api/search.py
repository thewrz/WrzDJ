from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin, get_db
from app.core.config import get_settings
from app.core.rate_limit import limiter
from app.models.search_cache import SearchCache
from app.models.user import User
from app.schemas.common import CacheClearResponse
from app.schemas.search import SearchResult
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
) -> list[SearchResult]:
    sys_settings = get_system_settings(db)
    if not sys_settings.spotify_enabled:
        raise HTTPException(status_code=503, detail="Spotify search is currently unavailable")
    return search_songs(db, q)


@router.delete("/cache", response_model=CacheClearResponse)
def clear_search_cache(
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> CacheClearResponse:
    """Clear all cached search results (admin only)."""
    count = db.query(SearchCache).delete()
    db.commit()
    return CacheClearResponse(message=f"Cleared {count} cached search results")
