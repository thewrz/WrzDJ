from fastapi import APIRouter

from app.api import auth, events, requests, search

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(events.router, prefix="/events", tags=["events"])
api_router.include_router(requests.router, prefix="/requests", tags=["requests"])
api_router.include_router(search.router, prefix="/search", tags=["search"])
