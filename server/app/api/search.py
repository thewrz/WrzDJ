from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin, get_db
from app.core.config import get_settings
from app.core.rate_limit import limiter
from app.models.search_cache import SearchCache
from app.models.user import User
from app.schemas.search import SearchResult
from app.services.spotify import search_songs

router = APIRouter()
settings = get_settings()


@router.get("", response_model=list[SearchResult])
@limiter.limit(lambda: f"{settings.search_rate_limit_per_minute}/minute")
async def search(
    request: Request,
    q: str = Query(..., min_length=2, max_length=200),
    db: Session = Depends(get_db),
) -> list[SearchResult]:
    results = await search_songs(db, q)
    return results


@router.delete("/cache")
def clear_search_cache(
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> dict:
    """Clear all cached search results (admin only)."""
    count = db.query(SearchCache).delete()
    db.commit()
    return {"message": f"Cleared {count} cached search results"}
