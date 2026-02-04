from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.search import SearchResult
from app.services.spotify import search_songs

router = APIRouter()


@router.get("", response_model=list[SearchResult])
async def search(
    q: str = Query(..., min_length=2, max_length=200),
    db: Session = Depends(get_db),
) -> list[SearchResult]:
    results = await search_songs(db, q)
    return results
