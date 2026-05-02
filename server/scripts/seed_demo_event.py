"""Seed a 'demo' event with 4 enriched requests + 1 upvoted, for screenshot fixtures."""

import hashlib
from datetime import timedelta

from app.core.time import utcnow
from app.db.session import SessionLocal
from app.models.event import Event
from app.models.request import Request as SongRequest
from app.models.user import User


def _dedupe_key(artist: str, title: str) -> str:
    return hashlib.sha1(f"{artist.lower()}|{title.lower()}".encode()).hexdigest()


def main() -> None:
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "admin").first()
        if not admin:
            raise SystemExit("admin user not found")

        event = db.query(Event).filter(Event.name == "demo").first()
        if event is None:
            event = Event(
                code="DEMO01",
                name="demo",
                created_by_user_id=admin.id,
                expires_at=utcnow() + timedelta(days=7),
                is_active=True,
                requests_open=True,
            )
            db.add(event)
            db.flush()
        else:
            event.expires_at = utcnow() + timedelta(days=7)
            event.is_active = True
            event.archived_at = None

        db.query(SongRequest).filter(SongRequest.event_id == event.id).delete()
        db.flush()

        seeds = [
            ("Daft Punk", "One More Time", "House", 123.0, "8A", "Marcus", 0),
            ("Fred again..", "Delilah", "UK Garage", 138.0, "11A", "Jenny", 7),
            ("CamelPhat", "Cola", "Tech House", 124.0, "5A", "Tyler", 0),
            ("Disclosure", "Latch", "Future Garage", 121.0, "10B", "Sasha", 0),
        ]

        for artist, title, genre, bpm, key, nick, votes in seeds:
            req = SongRequest(
                event_id=event.id,
                song_title=title,
                artist=artist,
                source="manual",
                nickname=nick,
                status="new",
                genre=genre,
                bpm=bpm,
                musical_key=key,
                vote_count=votes,
                dedupe_key=_dedupe_key(artist, title),
            )
            db.add(req)

        db.commit()
        print(f"seeded event '{event.name}' code={event.code} id={event.id}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
