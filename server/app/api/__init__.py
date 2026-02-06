from fastapi import APIRouter

from app.api import auth, bridge, events, public, requests, search, tidal

api_router = APIRouter()


@api_router.get("/health", tags=["health"])
def api_health_check():
    """Health check endpoint for monitoring and load balancers."""
    return {"status": "ok", "service": "api"}


api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(events.router, prefix="/events", tags=["events"])
api_router.include_router(requests.router, prefix="/requests", tags=["requests"])
api_router.include_router(search.router, prefix="/search", tags=["search"])
api_router.include_router(public.router, prefix="/public", tags=["public"])
api_router.include_router(bridge.router, tags=["bridge"])
api_router.include_router(tidal.router, prefix="/tidal", tags=["tidal"])
