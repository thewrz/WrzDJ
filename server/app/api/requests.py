from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.request import RequestStatus
from app.models.user import User
from app.schemas.request import RequestOut, RequestUpdate
from app.services.event import set_now_playing
from app.services.request import get_request_by_id, update_request_status

router = APIRouter()


@router.patch("/{request_id}", response_model=RequestOut)
def update_request(
    request_id: int,
    update_data: RequestUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RequestOut:
    request = get_request_by_id(db, request_id)
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")

    # Verify ownership through event
    if request.event.created_by_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to update this request")

    updated = update_request_status(db, request, update_data.status)

    # Auto-set now_playing when a request is set to "playing"
    if update_data.status == RequestStatus.PLAYING:
        set_now_playing(db, request.event, request.id)
    # Clear now_playing when the current song is marked as "played"
    elif update_data.status == RequestStatus.PLAYED:
        if request.event.now_playing_request_id == request.id:
            set_now_playing(db, request.event, None)

    return RequestOut(
        id=updated.id,
        event_id=updated.event_id,
        song_title=updated.song_title,
        artist=updated.artist,
        source=updated.source,
        source_url=updated.source_url,
        artwork_url=updated.artwork_url,
        note=updated.note,
        status=updated.status,
        created_at=updated.created_at,
        updated_at=updated.updated_at,
    )
