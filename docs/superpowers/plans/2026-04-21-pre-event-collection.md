# Pre-Event Song Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pre-event song collection mode — DJs configure "opens at" and "live at" dates, guests visit `/collect/[code]` to submit songs, upvote others, and see themselves on a live leaderboard. Requests accumulate in `NEW` until the DJ reviews them (anytime, or via a bulk-sweep view). At live-start, `/collect/[code]` auto-redirects to `/join/[code]`.

**Architecture:** Approach 1 — minimal extension of existing models. Four new columns on `events`, one new column on `requests`, a new `guest_profiles` table with encrypted email. A derived `Event.phase` computed property (`pre_announce | collection | live | closed`) drives routing and guards. A new `/api/public/collect/*` router handles guest traffic; DJ routes extend `events.py`. Frontend gets a new `/collect/[code]` page and a third `PreEventVotingTab` on the event-management page.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Alembic (backend), Next.js 16 + React 19 + TypeScript + zod + vanilla CSS (frontend), Fernet `EncryptedText` (email at rest), slowapi (rate limits), Pydantic (server validation), pytest + vitest (tests).

**Spec reference:** `docs/superpowers/specs/2026-04-21-pre-event-collection-design.md`

**Corrections from spec:** migration number is `034_add_pre_event_collection.py` (not `010`); `EncryptedText` lives in `app.core.encryption` (not `app.models.base`).

---

## Task 1: Alembic migration 034 — add columns + guest_profiles table

**Files:**
- Create: `server/alembic/versions/034_add_pre_event_collection.py`

- [ ] **Step 1: Create the migration file**

```python
"""Add pre-event collection columns + guest_profiles table.

Revision ID: 034
Revises: 033
"""

import sqlalchemy as sa

from alembic import op

revision = "034"
down_revision = "033"


def upgrade() -> None:
    # events columns
    op.add_column(
        "events",
        sa.Column("collection_opens_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "events",
        sa.Column("live_starts_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "events",
        sa.Column(
            "submission_cap_per_guest",
            sa.Integer(),
            nullable=False,
            server_default="15",
        ),
    )
    op.add_column(
        "events",
        sa.Column("collection_phase_override", sa.String(length=20), nullable=True),
    )

    # requests column
    op.add_column(
        "requests",
        sa.Column(
            "submitted_during_collection",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.create_index(
        "ix_requests_submitted_during_collection",
        "requests",
        ["submitted_during_collection"],
    )

    # guest_profiles table
    op.create_table(
        "guest_profiles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "event_id",
            sa.Integer(),
            sa.ForeignKey("events.id"),
            nullable=False,
        ),
        sa.Column("client_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("nickname", sa.String(length=30), nullable=True),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column(
            "submission_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            "event_id",
            "client_fingerprint",
            name="uq_guest_profile_event_fingerprint",
        ),
    )
    op.create_index("ix_guest_profiles_event_id", "guest_profiles", ["event_id"])
    op.create_index(
        "ix_guest_profiles_client_fingerprint",
        "guest_profiles",
        ["client_fingerprint"],
    )


def downgrade() -> None:
    op.drop_index("ix_guest_profiles_client_fingerprint", table_name="guest_profiles")
    op.drop_index("ix_guest_profiles_event_id", table_name="guest_profiles")
    op.drop_table("guest_profiles")
    op.drop_index(
        "ix_requests_submitted_during_collection", table_name="requests"
    )
    op.drop_column("requests", "submitted_during_collection")
    op.drop_column("events", "collection_phase_override")
    op.drop_column("events", "submission_cap_per_guest")
    op.drop_column("events", "live_starts_at")
    op.drop_column("events", "collection_opens_at")
```

- [ ] **Step 2: Run migration up + down locally to verify**

Run: `cd server && .venv/bin/alembic upgrade head && .venv/bin/alembic downgrade -1 && .venv/bin/alembic upgrade head`
Expected: All three commands succeed. No drift errors.

- [ ] **Step 3: Commit**

```bash
git add server/alembic/versions/034_add_pre_event_collection.py
git commit -m "feat(db): migration for pre-event collection columns and guest_profiles"
```

---

## Task 2: Update Event model — new columns + derived phase property

**Files:**
- Modify: `server/app/models/event.py`
- Test: `server/tests/test_event_phase.py`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/test_event_phase.py`:

```python
from datetime import timedelta

from app.core.time import utcnow
from app.models.event import Event


def _make_event(**kwargs) -> Event:
    now = utcnow()
    defaults = dict(
        code="ABCDEF",
        name="Test Event",
        created_by_user_id=1,
        expires_at=now + timedelta(days=30),
    )
    defaults.update(kwargs)
    return Event(**defaults)


def test_phase_no_collection_set_is_live():
    ev = _make_event()
    assert ev.phase == "live"


def test_phase_no_collection_after_expiry_is_closed():
    ev = _make_event(expires_at=utcnow() - timedelta(hours=1))
    assert ev.phase == "closed"


def test_phase_pre_announce_when_before_collection_opens():
    now = utcnow()
    ev = _make_event(
        collection_opens_at=now + timedelta(hours=1),
        live_starts_at=now + timedelta(days=1),
    )
    assert ev.phase == "pre_announce"


def test_phase_collection_when_between_opens_and_live():
    now = utcnow()
    ev = _make_event(
        collection_opens_at=now - timedelta(hours=1),
        live_starts_at=now + timedelta(hours=1),
    )
    assert ev.phase == "collection"


def test_phase_live_when_past_live_starts_at():
    now = utcnow()
    ev = _make_event(
        collection_opens_at=now - timedelta(days=2),
        live_starts_at=now - timedelta(hours=1),
    )
    assert ev.phase == "live"


def test_phase_override_force_live_wins():
    now = utcnow()
    ev = _make_event(
        collection_opens_at=now - timedelta(hours=1),
        live_starts_at=now + timedelta(hours=1),
        collection_phase_override="force_live",
    )
    assert ev.phase == "live"


def test_phase_override_force_collection_wins():
    now = utcnow()
    ev = _make_event(
        collection_opens_at=now - timedelta(days=2),
        live_starts_at=now - timedelta(hours=1),
        collection_phase_override="force_collection",
    )
    assert ev.phase == "collection"
```

- [ ] **Step 2: Run the failing tests**

Run: `cd server && .venv/bin/pytest tests/test_event_phase.py -v`
Expected: FAIL — `AttributeError: 'Event' object has no attribute 'phase'` (or column doesn't exist)

- [ ] **Step 3: Add columns and phase property**

Replace `server/app/models/event.py` with:

```python
from datetime import datetime
from typing import Literal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utcnow
from app.models.base import Base


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(10), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Tidal playlist sync
    tidal_playlist_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tidal_sync_enabled: Mapped[bool] = mapped_column(Boolean, default=False)

    # Beatport sync
    beatport_sync_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    beatport_playlist_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Display settings
    now_playing_auto_hide_minutes: Mapped[int] = mapped_column(
        Integer, default=10, nullable=False, server_default="10"
    )
    requests_open: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )

    # Kiosk display-only mode
    kiosk_display_only: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )

    # Custom banner image
    banner_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    banner_colors: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Pre-event collection
    collection_opens_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    live_starts_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    submission_cap_per_guest: Mapped[int] = mapped_column(
        Integer, default=15, nullable=False, server_default="15"
    )
    collection_phase_override: Mapped[str | None] = mapped_column(String(20), nullable=True)

    created_by: Mapped["User"] = relationship("User", back_populates="events")
    requests: Mapped[list["Request"]] = relationship(
        "Request", back_populates="event", foreign_keys="Request.event_id"
    )
    play_history: Mapped[list["PlayHistory"]] = relationship("PlayHistory", back_populates="event")

    @property
    def phase(self) -> Literal["pre_announce", "collection", "live", "closed"]:
        if self.collection_phase_override == "force_live":
            return "live"
        if self.collection_phase_override == "force_collection":
            return "collection"
        now = utcnow()
        if self.collection_opens_at and now < self.collection_opens_at:
            return "pre_announce"
        if self.live_starts_at and now < self.live_starts_at:
            return "collection"
        if now < self.expires_at:
            return "live"
        return "closed"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && .venv/bin/pytest tests/test_event_phase.py -v`
Expected: 7 passed

- [ ] **Step 5: Run alembic check to confirm no drift**

Run: `cd server && .venv/bin/alembic upgrade head && .venv/bin/alembic check`
Expected: "No new upgrade operations detected."

- [ ] **Step 6: Commit**

```bash
git add server/app/models/event.py server/tests/test_event_phase.py
git commit -m "feat(events): add pre-event collection columns + derived phase property"
```

---

## Task 3: Update Request model — submitted_during_collection column

**Files:**
- Modify: `server/app/models/request.py`

- [ ] **Step 1: Add the column**

Edit `server/app/models/request.py`. Add this column immediately after the existing `vote_count` column, before the `event` relationship:

```python
    # Pre-event collection flag — set on insert when event.phase == "collection"
    submitted_during_collection: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0", index=True
    )
```

Also add `Boolean` to the existing sqlalchemy import list at the top of the file if not already present.

- [ ] **Step 2: Run alembic check to confirm no drift**

Run: `cd server && .venv/bin/alembic upgrade head && .venv/bin/alembic check`
Expected: "No new upgrade operations detected."

- [ ] **Step 3: Run existing request tests to confirm no regression**

Run: `cd server && .venv/bin/pytest tests/test_requests.py -v`
Expected: All pass (column is optional with default, existing tests unaffected).

- [ ] **Step 4: Commit**

```bash
git add server/app/models/request.py
git commit -m "feat(requests): add submitted_during_collection flag"
```

---

## Task 4: Create GuestProfile model

**Files:**
- Create: `server/app/models/guest_profile.py`
- Modify: `server/app/models/__init__.py` (if it imports models — verify)
- Test: `server/tests/test_guest_profile.py`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/test_guest_profile.py`:

```python
import pytest
from sqlalchemy.exc import IntegrityError

from app.models.event import Event
from app.models.guest_profile import GuestProfile


def test_guest_profile_defaults(db, test_event: Event):
    profile = GuestProfile(
        event_id=test_event.id,
        client_fingerprint="fp_abc",
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    assert profile.nickname is None
    assert profile.email is None
    assert profile.submission_count == 0
    assert profile.created_at is not None


def test_guest_profile_uniqueness(db, test_event: Event):
    db.add(GuestProfile(event_id=test_event.id, client_fingerprint="fp_same"))
    db.commit()
    db.add(GuestProfile(event_id=test_event.id, client_fingerprint="fp_same"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_guest_profile_email_is_encrypted_at_rest(db, test_event: Event):
    profile = GuestProfile(
        event_id=test_event.id,
        client_fingerprint="fp_enc",
        email="guest@example.com",
    )
    db.add(profile)
    db.commit()

    raw = db.execute(
        __import__("sqlalchemy").text(
            "SELECT email FROM guest_profiles WHERE id = :id"
        ),
        {"id": profile.id},
    ).scalar()
    assert raw != "guest@example.com"
    assert raw is not None

    db.refresh(profile)
    assert profile.email == "guest@example.com"
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd server && .venv/bin/pytest tests/test_guest_profile.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models.guest_profile'`

- [ ] **Step 3: Create the model**

Create `server/app/models/guest_profile.py`:

```python
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.encryption import EncryptedText
from app.core.time import utcnow
from app.models.base import Base


class GuestProfile(Base):
    __tablename__ = "guest_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), index=True)
    client_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    nickname: Mapped[str | None] = mapped_column(String(30), nullable=True)
    email: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    submission_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "event_id",
            "client_fingerprint",
            name="uq_guest_profile_event_fingerprint",
        ),
    )
```

- [ ] **Step 4: Ensure the model is imported somewhere Alembic can see**

Run: `grep -rn "guest_profile\|GuestProfile" /home/adam/github/WrzDJ/server/app/models/__init__.py` — if models are auto-imported there, add the import. Otherwise Alembic's `env.py` already imports `app.models` which recursively discovers via the `Base` metadata only if the module is imported somewhere. Confirm by checking `server/alembic/env.py`:

Run: `grep -n "import.*models" /home/adam/github/WrzDJ/server/alembic/env.py`

If the pattern is `from app.models import *` or equivalent, add an explicit import line in `server/app/models/__init__.py`:

```python
from app.models.guest_profile import GuestProfile  # noqa: F401
```

- [ ] **Step 5: Run tests**

Run: `cd server && .venv/bin/pytest tests/test_guest_profile.py -v`
Expected: 3 passed.

- [ ] **Step 6: Run alembic check**

Run: `cd server && .venv/bin/alembic upgrade head && .venv/bin/alembic check`
Expected: "No new upgrade operations detected."

- [ ] **Step 7: Commit**

```bash
git add server/app/models/guest_profile.py server/app/models/__init__.py server/tests/test_guest_profile.py
git commit -m "feat(guest_profile): model with encrypted email + fingerprint uniqueness"
```

---

## Task 5: Collect Pydantic schemas

**Files:**
- Create: `server/app/schemas/collect.py`

- [ ] **Step 1: Create the schemas file**

```python
"""Pydantic schemas for pre-event collection endpoints."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, EmailStr, Field, StringConstraints

Nickname = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=30,
        pattern=r"^[a-zA-Z0-9 _.-]+$",
    ),
]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


class CollectPhase(BaseModel):
    phase: Literal["pre_announce", "collection", "live", "closed"]
    collection_opens_at: datetime | None
    live_starts_at: datetime | None
    expires_at: datetime


class CollectEventPreview(BaseModel):
    code: str
    name: str
    banner_filename: str | None
    submission_cap_per_guest: int
    registration_enabled: bool
    phase: Literal["pre_announce", "collection", "live", "closed"]
    collection_opens_at: datetime | None
    live_starts_at: datetime | None
    expires_at: datetime


class CollectLeaderboardRow(BaseModel):
    id: int
    title: str
    artist: str
    artwork_url: str | None
    vote_count: int
    nickname: str | None
    status: Literal["new", "accepted", "playing", "played", "rejected"]
    created_at: datetime


class CollectLeaderboardResponse(BaseModel):
    requests: list[CollectLeaderboardRow]
    total: int


class CollectProfileRequest(BaseModel):
    nickname: Nickname | None = None
    email: EmailStr | None = None


class CollectProfileResponse(BaseModel):
    nickname: str | None
    has_email: bool
    submission_count: int
    submission_cap: int


class CollectMyPicksItem(CollectLeaderboardRow):
    interaction: Literal["submitted", "upvoted"]


class CollectMyPicksResponse(BaseModel):
    submitted: list[CollectMyPicksItem]
    upvoted: list[CollectMyPicksItem]
    is_top_contributor: bool
    first_suggestion_ids: list[int]


class CollectSubmitRequest(BaseModel):
    song_title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    artist: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    source: Literal["spotify", "beatport", "tidal", "manual"]
    source_url: str | None = Field(default=None, max_length=500)
    artwork_url: str | None = Field(default=None, max_length=500)
    note: Note | None = None
    nickname: Nickname | None = None


class CollectVoteRequest(BaseModel):
    request_id: int


class UpdateCollectionSettings(BaseModel):
    collection_opens_at: datetime | None = None
    live_starts_at: datetime | None = None
    submission_cap_per_guest: int | None = Field(default=None, ge=0, le=100)
    collection_phase_override: Literal["force_collection", "force_live"] | None = None


class PendingReviewRow(BaseModel):
    id: int
    song_title: str
    artist: str
    artwork_url: str | None
    vote_count: int
    nickname: str | None
    created_at: datetime
    note: str | None
    status: Literal["new", "accepted", "playing", "played", "rejected"]


class PendingReviewResponse(BaseModel):
    requests: list[PendingReviewRow]
    total: int


class BulkReviewRequest(BaseModel):
    action: Literal[
        "accept_top_n",
        "accept_threshold",
        "accept_ids",
        "reject_ids",
        "reject_remaining",
    ]
    n: int | None = Field(default=None, ge=1, le=200)
    min_votes: int | None = Field(default=None, ge=0)
    request_ids: list[int] | None = Field(default=None, max_length=200)


class BulkReviewResponse(BaseModel):
    accepted: int
    rejected: int
    unchanged: int
```

- [ ] **Step 2: Smoke-test imports**

Run: `cd server && .venv/bin/python -c "from app.schemas import collect; print(collect.CollectEventPreview.model_fields.keys())"`
Expected: No errors, prints field keys.

- [ ] **Step 3: Commit**

```bash
git add server/app/schemas/collect.py
git commit -m "feat(collect): pydantic schemas for pre-event collection endpoints"
```

---

## Task 6: Collect service — profile upsert + submission cap

**Files:**
- Create: `server/app/services/collect.py`
- Test: `server/tests/test_collect_service.py`

- [ ] **Step 1: Write failing tests**

Create `server/tests/test_collect_service.py`:

```python
from datetime import timedelta

import pytest

from app.core.time import utcnow
from app.models.event import Event
from app.models.guest_profile import GuestProfile
from app.services import collect as collect_service


def _enable_collection(db, event: Event):
    now = utcnow()
    event.collection_opens_at = now - timedelta(hours=1)
    event.live_starts_at = now + timedelta(hours=1)
    event.submission_cap_per_guest = 3
    db.commit()
    db.refresh(event)


def test_upsert_profile_creates_row(db, test_event: Event):
    profile = collect_service.upsert_profile(
        db, event_id=test_event.id, fingerprint="fp1", nickname="Alex"
    )
    assert profile.nickname == "Alex"
    assert profile.email is None
    assert profile.submission_count == 0


def test_upsert_profile_preserves_email_when_only_nickname_given(db, test_event: Event):
    collect_service.upsert_profile(
        db, event_id=test_event.id, fingerprint="fp2", email="g@example.com"
    )
    profile = collect_service.upsert_profile(
        db, event_id=test_event.id, fingerprint="fp2", nickname="NewName"
    )
    assert profile.email == "g@example.com"
    assert profile.nickname == "NewName"


def test_check_and_increment_submission_count_blocks_at_cap(db, test_event: Event):
    _enable_collection(db, test_event)
    for _ in range(3):
        collect_service.check_and_increment_submission_count(
            db, event=test_event, fingerprint="fp3"
        )
    with pytest.raises(collect_service.SubmissionCapExceeded):
        collect_service.check_and_increment_submission_count(
            db, event=test_event, fingerprint="fp3"
        )


def test_check_and_increment_allows_unlimited_when_cap_zero(db, test_event: Event):
    _enable_collection(db, test_event)
    test_event.submission_cap_per_guest = 0
    db.commit()
    for _ in range(20):
        collect_service.check_and_increment_submission_count(
            db, event=test_event, fingerprint="fp4"
        )
    profile = (
        db.query(GuestProfile)
        .filter(
            GuestProfile.event_id == test_event.id,
            GuestProfile.client_fingerprint == "fp4",
        )
        .one()
    )
    assert profile.submission_count == 20
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd server && .venv/bin/pytest tests/test_collect_service.py -v`
Expected: FAIL — `ModuleNotFoundError` on `app.services.collect`.

- [ ] **Step 3: Create the service**

Create `server/app/services/collect.py`:

```python
"""Service layer for pre-event collection."""

from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.guest_profile import GuestProfile


class SubmissionCapExceeded(Exception):
    """Raised when a guest has hit their per-event submission cap."""


def get_profile(
    db: Session, *, event_id: int, fingerprint: str
) -> GuestProfile | None:
    return (
        db.query(GuestProfile)
        .filter(
            GuestProfile.event_id == event_id,
            GuestProfile.client_fingerprint == fingerprint,
        )
        .one_or_none()
    )


def upsert_profile(
    db: Session,
    *,
    event_id: int,
    fingerprint: str,
    nickname: str | None = None,
    email: str | None = None,
) -> GuestProfile:
    profile = get_profile(db, event_id=event_id, fingerprint=fingerprint)
    if profile is None:
        profile = GuestProfile(
            event_id=event_id,
            client_fingerprint=fingerprint,
            nickname=nickname,
            email=email,
        )
        db.add(profile)
    else:
        if nickname is not None:
            profile.nickname = nickname
        if email is not None:
            profile.email = email
    db.commit()
    db.refresh(profile)
    return profile


def check_and_increment_submission_count(
    db: Session, *, event: Event, fingerprint: str
) -> GuestProfile:
    """Atomically enforce the per-guest cap, incrementing submission_count on success.

    Raises SubmissionCapExceeded when the cap would be exceeded. cap == 0 means
    unlimited (explicit by design).
    """
    profile = get_profile(db, event_id=event.id, fingerprint=fingerprint)
    if profile is None:
        profile = GuestProfile(
            event_id=event.id,
            client_fingerprint=fingerprint,
        )
        db.add(profile)
        db.flush()

    cap = event.submission_cap_per_guest
    if cap != 0 and profile.submission_count >= cap:
        db.rollback()
        raise SubmissionCapExceeded()

    profile.submission_count += 1
    db.commit()
    db.refresh(profile)
    return profile
```

- [ ] **Step 4: Run tests to verify green**

Run: `cd server && .venv/bin/pytest tests/test_collect_service.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add server/app/services/collect.py server/tests/test_collect_service.py
git commit -m "feat(collect): service for profile upsert + submission cap enforcement"
```

---

## Task 7: Collect public API router — preview + leaderboard endpoints

**Files:**
- Create: `server/app/api/collect.py`
- Modify: `server/app/api/__init__.py`
- Test: `server/tests/test_collect_public.py`

- [ ] **Step 1: Write failing tests for preview + leaderboard**

Create `server/tests/test_collect_public.py`:

```python
from datetime import timedelta

from app.core.time import utcnow
from app.models.event import Event


def _enable_collection(db, event: Event):
    now = utcnow()
    event.collection_opens_at = now - timedelta(hours=1)
    event.live_starts_at = now + timedelta(hours=1)
    db.commit()
    db.refresh(event)


def test_collect_preview_returns_phase(client, db, test_event: Event):
    _enable_collection(db, test_event)
    r = client.get(f"/api/public/collect/{test_event.code}")
    assert r.status_code == 200
    body = r.json()
    assert body["code"] == test_event.code
    assert body["phase"] == "collection"
    assert body["submission_cap_per_guest"] == 15


def test_collect_preview_404_for_unknown_code(client):
    r = client.get("/api/public/collect/ZZZZZZ")
    assert r.status_code == 404


def test_collect_leaderboard_empty(client, db, test_event: Event):
    _enable_collection(db, test_event)
    r = client.get(f"/api/public/collect/{test_event.code}/leaderboard")
    assert r.status_code == 200
    body = r.json()
    assert body["requests"] == []
    assert body["total"] == 0


def test_collect_leaderboard_trending_sorts_by_votes(client, db, test_event, collection_requests):
    _enable_collection(db, test_event)
    # collection_requests fixture creates 3 requests with vote_count 5, 2, 0
    r = client.get(
        f"/api/public/collect/{test_event.code}/leaderboard?tab=trending"
    )
    assert r.status_code == 200
    votes = [row["vote_count"] for row in r.json()["requests"]]
    assert votes == sorted(votes, reverse=True)
    # vote_count 0 excluded from trending
    assert 0 not in votes


def test_collect_leaderboard_all_tab_includes_zero_votes(
    client, db, test_event, collection_requests
):
    _enable_collection(db, test_event)
    r = client.get(f"/api/public/collect/{test_event.code}/leaderboard?tab=all")
    assert r.status_code == 200
    votes = [row["vote_count"] for row in r.json()["requests"]]
    assert 0 in votes
```

- [ ] **Step 2: Add the `collection_requests` fixture**

Edit `server/tests/conftest.py`. Add this fixture:

```python
@pytest.fixture
def collection_requests(db, test_event):
    """Creates 3 collection-submitted NEW requests with vote counts 5, 2, 0."""
    from app.models.request import Request, RequestStatus
    now = utcnow()
    rows = []
    for i, votes in enumerate([5, 2, 0]):
        r = Request(
            event_id=test_event.id,
            song_title=f"Song {i}",
            artist=f"Artist {i}",
            source="spotify",
            status=RequestStatus.NEW.value,
            vote_count=votes,
            dedupe_key=f"dk_{i}",
            submitted_during_collection=True,
            created_at=now,
        )
        db.add(r)
        rows.append(r)
    db.commit()
    for r in rows:
        db.refresh(r)
    return rows
```

If `utcnow` and `pytest` are not already imported at the top of `conftest.py`, add the missing imports.

- [ ] **Step 3: Create the router with preview + leaderboard**

Create `server/app/api/collect.py`:

```python
"""Public API endpoints for pre-event song collection (no authentication required)."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.rate_limit import get_client_fingerprint, limiter
from app.models.event import Event
from app.models.request import Request as SongRequest
from app.schemas.collect import (
    CollectEventPreview,
    CollectLeaderboardResponse,
    CollectLeaderboardRow,
)
from app.services.system_settings import get_system_settings

router = APIRouter()


def _get_event_or_404(db: Session, code: str) -> Event:
    event = db.query(Event).filter(Event.code == code).one_or_none()
    if event is None or not event.is_active:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@router.get("/{code}", response_model=CollectEventPreview)
@limiter.limit("120/minute")
def preview(code: str, request: Request, db: Session = Depends(get_db)):
    event = _get_event_or_404(db, code)
    settings = get_system_settings(db)
    return CollectEventPreview(
        code=event.code,
        name=event.name,
        banner_filename=event.banner_filename,
        submission_cap_per_guest=event.submission_cap_per_guest,
        registration_enabled=settings.registration_enabled,
        phase=event.phase,
        collection_opens_at=event.collection_opens_at,
        live_starts_at=event.live_starts_at,
        expires_at=event.expires_at,
    )


@router.get("/{code}/leaderboard", response_model=CollectLeaderboardResponse)
@limiter.limit("120/minute")
def leaderboard(
    code: str,
    request: Request,
    tab: Literal["trending", "all"] = "trending",
    db: Session = Depends(get_db),
):
    event = _get_event_or_404(db, code)

    q = (
        db.query(SongRequest)
        .filter(SongRequest.event_id == event.id)
        .filter(SongRequest.submitted_during_collection == True)  # noqa: E712
    )
    if tab == "trending":
        q = q.filter(SongRequest.vote_count >= 1).order_by(
            SongRequest.vote_count.desc(), SongRequest.created_at.desc()
        )
    else:
        q = q.order_by(SongRequest.created_at.desc())

    rows = q.limit(200).all()
    return CollectLeaderboardResponse(
        requests=[
            CollectLeaderboardRow(
                id=r.id,
                title=r.song_title,
                artist=r.artist,
                artwork_url=r.artwork_url,
                vote_count=r.vote_count,
                nickname=r.nickname,
                status=r.status,
                created_at=r.created_at,
            )
            for r in rows
        ],
        total=len(rows),
    )
```

- [ ] **Step 4: Register the router**

Edit `server/app/api/__init__.py` — add `collect` to the import block and include:

```python
from app.api import (
    admin,
    auth,
    beatport,
    bridge,
    collect,
    events,
    kiosk,
    public,
    requests,
    search,
    sse,
    tidal,
    votes,
)
```

Add this line after the existing `include_router` calls:

```python
api_router.include_router(collect.router, prefix="/public/collect", tags=["collect"])
```

- [ ] **Step 5: Run tests**

Run: `cd server && .venv/bin/pytest tests/test_collect_public.py -v`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add server/app/api/collect.py server/app/api/__init__.py server/tests/test_collect_public.py server/tests/conftest.py
git commit -m "feat(collect): GET preview + leaderboard public endpoints"
```

---

## Task 8: Profile endpoints — POST /profile and GET /profile/me

**Files:**
- Modify: `server/app/api/collect.py`
- Modify: `server/tests/test_collect_public.py`

- [ ] **Step 1: Write failing tests**

Append to `server/tests/test_collect_public.py`:

```python
def test_collect_profile_set_nickname(client, db, test_event):
    _enable_collection(db, test_event)
    r = client.post(
        f"/api/public/collect/{test_event.code}/profile",
        json={"nickname": "DancingQueen"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["nickname"] == "DancingQueen"
    assert body["has_email"] is False
    assert body["submission_count"] == 0
    assert body["submission_cap"] == 15


def test_collect_profile_invalid_nickname_rejected(client, db, test_event):
    _enable_collection(db, test_event)
    r = client.post(
        f"/api/public/collect/{test_event.code}/profile",
        json={"nickname": "<script>alert(1)</script>"},
    )
    assert r.status_code == 422


def test_collect_profile_accepts_email(client, db, test_event):
    _enable_collection(db, test_event)
    r = client.post(
        f"/api/public/collect/{test_event.code}/profile",
        json={"nickname": "A", "email": "guest@example.com"},
    )
    assert r.status_code == 200
    assert r.json()["has_email"] is True


def test_collect_profile_me_empty_when_no_interactions(client, db, test_event):
    _enable_collection(db, test_event)
    r = client.get(f"/api/public/collect/{test_event.code}/profile/me")
    assert r.status_code == 200
    body = r.json()
    assert body["submitted"] == []
    assert body["upvoted"] == []
    assert body["is_top_contributor"] is False
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd server && .venv/bin/pytest tests/test_collect_public.py::test_collect_profile_set_nickname -v`
Expected: FAIL — 404 or similar.

- [ ] **Step 3: Add the endpoints to `server/app/api/collect.py`**

Add these imports at the top:

```python
from app.models.guest_profile import GuestProfile
from app.models.request_vote import RequestVote
from app.schemas.collect import (
    CollectEventPreview,
    CollectLeaderboardResponse,
    CollectLeaderboardRow,
    CollectMyPicksItem,
    CollectMyPicksResponse,
    CollectProfileRequest,
    CollectProfileResponse,
)
from app.services import collect as collect_service
```

(Adjust the existing import block — keep `CollectEventPreview`/`CollectLeaderboardResponse`/`CollectLeaderboardRow` already imported.)

Confirm the actual file location of `RequestVote` before adding that import:

```bash
grep -rn "class RequestVote" /home/adam/github/WrzDJ/server/app/models/
```

Use whatever module path that reveals (e.g., `app.models.request_vote` or `app.models.vote`).

Append these endpoints at the bottom of `server/app/api/collect.py`:

```python
@router.post("/{code}/profile", response_model=CollectProfileResponse)
@limiter.limit("5/minute")
def set_profile(
    code: str,
    payload: CollectProfileRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    event = _get_event_or_404(db, code)
    fingerprint = get_client_fingerprint(request)
    profile = collect_service.upsert_profile(
        db,
        event_id=event.id,
        fingerprint=fingerprint,
        nickname=payload.nickname,
        email=payload.email,
    )
    return CollectProfileResponse(
        nickname=profile.nickname,
        has_email=profile.email is not None,
        submission_count=profile.submission_count,
        submission_cap=event.submission_cap_per_guest,
    )


@router.get("/{code}/profile/me", response_model=CollectMyPicksResponse)
@limiter.limit("60/minute")
def my_picks(code: str, request: Request, db: Session = Depends(get_db)):
    event = _get_event_or_404(db, code)
    fingerprint = get_client_fingerprint(request)

    submitted = (
        db.query(SongRequest)
        .filter(SongRequest.event_id == event.id)
        .filter(SongRequest.submitted_during_collection == True)  # noqa: E712
        .filter(SongRequest.client_fingerprint == fingerprint)
        .order_by(SongRequest.created_at.desc())
        .all()
    )

    upvoted_request_ids = [
        rv.request_id
        for rv in db.query(RequestVote)
        .filter(RequestVote.client_fingerprint == fingerprint)
        .all()
    ]
    upvoted: list[SongRequest] = []
    if upvoted_request_ids:
        upvoted = (
            db.query(SongRequest)
            .filter(SongRequest.event_id == event.id)
            .filter(SongRequest.id.in_(upvoted_request_ids))
            .filter(SongRequest.submitted_during_collection == True)  # noqa: E712
            .all()
        )

    # Gamification: top contributor = this fingerprint has the most submissions
    # in this event (among collection submissions).
    top_fingerprint_row = (
        db.query(SongRequest.client_fingerprint, __import__("sqlalchemy").func.count(SongRequest.id).label("n"))
        .filter(SongRequest.event_id == event.id)
        .filter(SongRequest.submitted_during_collection == True)  # noqa: E712
        .filter(SongRequest.client_fingerprint.isnot(None))
        .group_by(SongRequest.client_fingerprint)
        .order_by(__import__("sqlalchemy").desc("n"))
        .first()
    )
    is_top = (
        top_fingerprint_row is not None
        and top_fingerprint_row[0] == fingerprint
        and top_fingerprint_row[1] > 0
    )

    # First-to-suggest: among submitted rows, the ones where no earlier row in the
    # event shares the same dedupe_key.
    first_suggestion_ids: list[int] = []
    for r in submitted:
        earlier = (
            db.query(SongRequest.id)
            .filter(SongRequest.event_id == event.id)
            .filter(SongRequest.dedupe_key == r.dedupe_key)
            .filter(SongRequest.created_at < r.created_at)
            .first()
        )
        if earlier is None:
            first_suggestion_ids.append(r.id)

    def _to_row(r: SongRequest, interaction: str) -> CollectMyPicksItem:
        return CollectMyPicksItem(
            id=r.id,
            title=r.song_title,
            artist=r.artist,
            artwork_url=r.artwork_url,
            vote_count=r.vote_count,
            nickname=r.nickname,
            status=r.status,
            created_at=r.created_at,
            interaction=interaction,
        )

    return CollectMyPicksResponse(
        submitted=[_to_row(r, "submitted") for r in submitted],
        upvoted=[_to_row(r, "upvoted") for r in upvoted if r.id not in [s.id for s in submitted]],
        is_top_contributor=is_top,
        first_suggestion_ids=first_suggestion_ids,
    )
```

- [ ] **Step 4: Run tests**

Run: `cd server && .venv/bin/pytest tests/test_collect_public.py -v`
Expected: 9 passed (5 previous + 4 new).

- [ ] **Step 5: Commit**

```bash
git add server/app/api/collect.py server/tests/test_collect_public.py
git commit -m "feat(collect): POST profile + GET my picks with gamification"
```

---

## Task 9: Submit + vote endpoints (phase-gated, cap-enforced)

**Files:**
- Modify: `server/app/api/collect.py`
- Modify: `server/tests/test_collect_public.py`

- [ ] **Step 1: Write failing tests**

Append to `server/tests/test_collect_public.py`:

```python
def test_collect_submit_creates_request_in_collection_phase(client, db, test_event):
    _enable_collection(db, test_event)
    r = client.post(
        f"/api/public/collect/{test_event.code}/requests",
        json={
            "song_title": "Mr. Brightside",
            "artist": "The Killers",
            "source": "spotify",
            "source_url": "https://open.spotify.com/track/abc",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["id"] > 0

    from app.models.request import Request as SongRequest
    row = db.query(SongRequest).filter(SongRequest.id == body["id"]).one()
    assert row.submitted_during_collection is True
    assert row.status == "new"


def test_collect_submit_rejected_during_live_phase(client, db, test_event):
    # event without collection fields → phase == "live"
    r = client.post(
        f"/api/public/collect/{test_event.code}/requests",
        json={"song_title": "A", "artist": "B", "source": "spotify"},
    )
    assert r.status_code == 409
    assert "Collection" in r.json()["detail"]


def test_collect_submit_blocked_at_cap(client, db, test_event):
    _enable_collection(db, test_event)
    test_event.submission_cap_per_guest = 2
    db.commit()
    for _ in range(2):
        r = client.post(
            f"/api/public/collect/{test_event.code}/requests",
            json={"song_title": "A", "artist": "B", "source": "spotify"},
        )
        assert r.status_code == 201
    r3 = client.post(
        f"/api/public/collect/{test_event.code}/requests",
        json={"song_title": "C", "artist": "D", "source": "spotify"},
    )
    assert r3.status_code == 429
    assert "Picks limit reached" in r3.json()["detail"]


def test_collect_vote_increments_count(client, db, test_event, collection_requests):
    _enable_collection(db, test_event)
    req = collection_requests[0]
    before = req.vote_count
    r = client.post(
        f"/api/public/collect/{test_event.code}/vote",
        json={"request_id": req.id},
    )
    assert r.status_code == 200
    db.refresh(req)
    assert req.vote_count == before + 1


def test_collect_vote_is_idempotent(client, db, test_event, collection_requests):
    _enable_collection(db, test_event)
    req = collection_requests[0]
    client.post(
        f"/api/public/collect/{test_event.code}/vote",
        json={"request_id": req.id},
    )
    before = db.query(type(req)).filter(type(req).id == req.id).one().vote_count
    client.post(
        f"/api/public/collect/{test_event.code}/vote",
        json={"request_id": req.id},
    )
    after = db.query(type(req)).filter(type(req).id == req.id).one().vote_count
    assert after == before
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd server && .venv/bin/pytest tests/test_collect_public.py -v -k "submit or vote"`
Expected: FAIL (endpoints not defined).

- [ ] **Step 3: Implement the endpoints**

Append to `server/app/api/collect.py`:

```python
import hashlib

from fastapi.responses import JSONResponse

from app.models.request import Request as SongRequest
from app.models.request import RequestSource, RequestStatus
from app.schemas.collect import CollectSubmitRequest, CollectVoteRequest
from app.services.vote import record_vote


def _compute_dedupe_key(song_title: str, artist: str) -> str:
    raw = f"{song_title.strip().lower()}|{artist.strip().lower()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:64]


@router.post("/{code}/requests", status_code=201)
@limiter.limit("10/minute")
def submit(
    code: str,
    payload: CollectSubmitRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    event = _get_event_or_404(db, code)
    if event.phase != "collection":
        raise HTTPException(status_code=409, detail="Collection has ended")

    fingerprint = get_client_fingerprint(request)
    try:
        collect_service.check_and_increment_submission_count(
            db, event=event, fingerprint=fingerprint
        )
    except collect_service.SubmissionCapExceeded:
        raise HTTPException(status_code=429, detail="Picks limit reached") from None

    if payload.nickname:
        collect_service.upsert_profile(
            db,
            event_id=event.id,
            fingerprint=fingerprint,
            nickname=payload.nickname,
        )

    row = SongRequest(
        event_id=event.id,
        song_title=payload.song_title,
        artist=payload.artist,
        source=payload.source,
        source_url=payload.source_url,
        artwork_url=payload.artwork_url,
        note=payload.note,
        nickname=payload.nickname,
        status=RequestStatus.NEW.value,
        dedupe_key=_compute_dedupe_key(payload.song_title, payload.artist),
        client_fingerprint=fingerprint,
        submitted_during_collection=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id}


@router.post("/{code}/vote")
@limiter.limit("60/minute")
def vote(
    code: str,
    payload: CollectVoteRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    event = _get_event_or_404(db, code)
    if event.phase not in ("collection", "live"):
        raise HTTPException(status_code=409, detail="Voting is closed")
    fingerprint = get_client_fingerprint(request)
    row = (
        db.query(SongRequest)
        .filter(SongRequest.id == payload.request_id)
        .filter(SongRequest.event_id == event.id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Request not found")
    record_vote(db, request_id=row.id, fingerprint=fingerprint)
    return {"ok": True}
```

**Note:** Confirm the actual function name in `server/app/services/vote.py` — adjust `record_vote` to match. Run:

```bash
grep -n "^def " /home/adam/github/WrzDJ/server/app/services/vote.py
```

Use whatever function is the idempotent-vote entry point. If the signature differs, adjust the call accordingly.

- [ ] **Step 4: Run tests**

Run: `cd server && .venv/bin/pytest tests/test_collect_public.py -v`
Expected: 14 passed (9 previous + 5 new).

- [ ] **Step 5: Commit**

```bash
git add server/app/api/collect.py server/tests/test_collect_public.py
git commit -m "feat(collect): POST submit (phase-gated, cap-enforced) + POST vote"
```

---

## Task 10: DJ endpoint — PATCH /api/events/{code}/collection

**Files:**
- Modify: `server/app/api/events.py`
- Test: `server/tests/test_collect_dj.py`

- [ ] **Step 1: Write failing tests**

Create `server/tests/test_collect_dj.py`:

```python
from datetime import timedelta

from app.core.time import utcnow


def test_patch_collection_sets_dates(client, db, auth_headers, test_event):
    now = utcnow()
    payload = {
        "collection_opens_at": (now + timedelta(hours=1)).isoformat(),
        "live_starts_at": (now + timedelta(days=1)).isoformat(),
        "submission_cap_per_guest": 10,
    }
    r = client.patch(
        f"/api/events/{test_event.code}/collection",
        json=payload,
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    db.refresh(test_event)
    assert test_event.submission_cap_per_guest == 10
    assert test_event.collection_opens_at is not None


def test_patch_collection_rejects_bad_ordering(client, auth_headers, test_event):
    now = utcnow()
    payload = {
        "collection_opens_at": (now + timedelta(days=2)).isoformat(),
        "live_starts_at": (now + timedelta(days=1)).isoformat(),
    }
    r = client.patch(
        f"/api/events/{test_event.code}/collection",
        json=payload,
        headers=auth_headers,
    )
    assert r.status_code == 400


def test_patch_collection_requires_ownership(client, db, admin_user, test_event):
    # test_event is owned by test_user; admin_user is someone else
    # generate a token for a DIFFERENT non-admin user
    from app.models.user import User
    from app.services.auth import create_access_token
    other = User(username="otherdj", hashed_password="x", role="dj")
    db.add(other)
    db.commit()
    db.refresh(other)
    token = create_access_token(subject=str(other.id), token_version=other.token_version)
    r = client.patch(
        f"/api/events/{test_event.code}/collection",
        json={"submission_cap_per_guest": 5},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


def test_patch_collection_override_accepted(client, db, auth_headers, test_event):
    r = client.patch(
        f"/api/events/{test_event.code}/collection",
        json={"collection_phase_override": "force_live"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    db.refresh(test_event)
    assert test_event.collection_phase_override == "force_live"


def test_patch_collection_override_bad_value(client, auth_headers, test_event):
    r = client.patch(
        f"/api/events/{test_event.code}/collection",
        json={"collection_phase_override": "skydiving"},
        headers=auth_headers,
    )
    assert r.status_code == 422
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd server && .venv/bin/pytest tests/test_collect_dj.py -v`
Expected: FAIL — 404 for the PATCH route.

- [ ] **Step 3: Check existing auth service for token creation helper**

Run: `grep -n "create_access_token" /home/adam/github/WrzDJ/server/app/services/auth.py | head -5`

Adjust the `test_patch_collection_requires_ownership` test above if the signature differs — replace the call to match what exists.

- [ ] **Step 4: Add the PATCH endpoint to `server/app/api/events.py`**

Find the existing ownership-check helper (likely `_get_event_for_user` or similar). Add imports:

```python
from app.schemas.collect import UpdateCollectionSettings
```

Add the new endpoint (place near other event-settings endpoints):

```python
@router.patch("/{code}/collection")
def update_collection_settings(
    code: str,
    payload: UpdateCollectionSettings,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    event = db.query(Event).filter(Event.code == code).one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.created_by_user_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")

    if payload.collection_opens_at is not None:
        event.collection_opens_at = payload.collection_opens_at
    if payload.live_starts_at is not None:
        event.live_starts_at = payload.live_starts_at
    if payload.submission_cap_per_guest is not None:
        event.submission_cap_per_guest = payload.submission_cap_per_guest
    if payload.collection_phase_override is not None or (
        "collection_phase_override" in payload.model_fields_set
    ):
        event.collection_phase_override = payload.collection_phase_override

    # Validate ordering
    opens = event.collection_opens_at
    live = event.live_starts_at
    expires = event.expires_at
    if opens and live and opens >= live:
        raise HTTPException(status_code=400, detail="collection_opens_at must be before live_starts_at")
    if live and expires and live >= expires:
        raise HTTPException(status_code=400, detail="live_starts_at must be before expires_at")

    db.commit()
    db.refresh(event)
    return {
        "collection_opens_at": event.collection_opens_at,
        "live_starts_at": event.live_starts_at,
        "submission_cap_per_guest": event.submission_cap_per_guest,
        "collection_phase_override": event.collection_phase_override,
        "phase": event.phase,
    }
```

Ensure `Event`, `User`, `get_current_active_user`, `get_db`, `Session`, `APIRouter`, `HTTPException`, `Depends` are already imported at the top of `events.py` (they will be — existing file uses them).

- [ ] **Step 5: Run tests**

Run: `cd server && .venv/bin/pytest tests/test_collect_dj.py -v`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add server/app/api/events.py server/tests/test_collect_dj.py
git commit -m "feat(collect): PATCH /events/{code}/collection — update dates + override"
```

---

## Task 11: DJ endpoint — GET pending-review

**Files:**
- Modify: `server/app/api/events.py`
- Modify: `server/tests/test_collect_dj.py`

- [ ] **Step 1: Write failing test**

Append to `server/tests/test_collect_dj.py`:

```python
def test_pending_review_returns_collection_news_sorted_by_votes(
    client, auth_headers, test_event, collection_requests
):
    r = client.get(
        f"/api/events/{test_event.code}/pending-review",
        headers=auth_headers,
    )
    assert r.status_code == 200
    rows = r.json()["requests"]
    # collection_requests fixture has vote_count 5, 2, 0
    assert [row["vote_count"] for row in rows] == [5, 2, 0]


def test_pending_review_excludes_accepted(
    client, db, auth_headers, test_event, collection_requests
):
    collection_requests[0].status = "accepted"
    db.commit()
    r = client.get(
        f"/api/events/{test_event.code}/pending-review",
        headers=auth_headers,
    )
    votes = [row["vote_count"] for row in r.json()["requests"]]
    assert 5 not in votes  # that request is now accepted


def test_pending_review_requires_ownership(
    client, db, test_event
):
    from app.models.user import User
    from app.services.auth import create_access_token
    other = User(username="otherdj2", hashed_password="x", role="dj")
    db.add(other)
    db.commit()
    db.refresh(other)
    token = create_access_token(subject=str(other.id), token_version=other.token_version)
    r = client.get(
        f"/api/events/{test_event.code}/pending-review",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd server && .venv/bin/pytest tests/test_collect_dj.py -v -k "pending"`
Expected: FAIL.

- [ ] **Step 3: Add the endpoint**

Append to `server/app/api/events.py` (near the PATCH added in Task 10). Add the schema import if not already:

```python
from app.schemas.collect import PendingReviewResponse, PendingReviewRow
```

Add endpoint:

```python
@router.get("/{code}/pending-review", response_model=PendingReviewResponse)
def pending_review(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    event = db.query(Event).filter(Event.code == code).one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.created_by_user_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")

    from app.models.request import Request as SongRequest
    rows = (
        db.query(SongRequest)
        .filter(SongRequest.event_id == event.id)
        .filter(SongRequest.submitted_during_collection == True)  # noqa: E712
        .filter(SongRequest.status == "new")
        .order_by(SongRequest.vote_count.desc(), SongRequest.created_at.asc())
        .limit(200)
        .all()
    )
    return PendingReviewResponse(
        requests=[
            PendingReviewRow(
                id=r.id,
                song_title=r.song_title,
                artist=r.artist,
                artwork_url=r.artwork_url,
                vote_count=r.vote_count,
                nickname=r.nickname,
                created_at=r.created_at,
                note=r.note,
                status=r.status,
            )
            for r in rows
        ],
        total=len(rows),
    )
```

- [ ] **Step 4: Run tests**

Run: `cd server && .venv/bin/pytest tests/test_collect_dj.py -v`
Expected: 8 passed (5 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add server/app/api/events.py server/tests/test_collect_dj.py
git commit -m "feat(collect): GET /events/{code}/pending-review for DJ bulk-review"
```

---

## Task 12: DJ endpoint — POST bulk-review

**Files:**
- Modify: `server/app/api/events.py`
- Modify: `server/tests/test_collect_dj.py`

- [ ] **Step 1: Write failing tests**

Append to `server/tests/test_collect_dj.py`:

```python
def test_bulk_review_accept_top_n(
    client, db, auth_headers, test_event, collection_requests
):
    r = client.post(
        f"/api/events/{test_event.code}/bulk-review",
        json={"action": "accept_top_n", "n": 2},
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["accepted"] == 2
    for row in collection_requests:
        db.refresh(row)
    statuses = sorted(r.status for r in collection_requests)
    assert statuses == ["accepted", "accepted", "new"]


def test_bulk_review_accept_threshold(
    client, db, auth_headers, test_event, collection_requests
):
    r = client.post(
        f"/api/events/{test_event.code}/bulk-review",
        json={"action": "accept_threshold", "min_votes": 3},
        headers=auth_headers,
    )
    assert r.status_code == 200
    # Only the vote_count=5 row qualifies
    assert r.json()["accepted"] == 1


def test_bulk_review_reject_remaining(
    client, db, auth_headers, test_event, collection_requests
):
    r = client.post(
        f"/api/events/{test_event.code}/bulk-review",
        json={"action": "reject_remaining"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.json()["rejected"] == 3


def test_bulk_review_accept_ids(
    client, db, auth_headers, test_event, collection_requests
):
    ids = [collection_requests[0].id, collection_requests[2].id]
    r = client.post(
        f"/api/events/{test_event.code}/bulk-review",
        json={"action": "accept_ids", "request_ids": ids},
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.json()["accepted"] == 2


def test_bulk_review_rejects_over_200_ids(
    client, auth_headers, test_event
):
    ids = list(range(1, 250))
    r = client.post(
        f"/api/events/{test_event.code}/bulk-review",
        json={"action": "accept_ids", "request_ids": ids},
        headers=auth_headers,
    )
    assert r.status_code == 422


def test_bulk_review_bad_action(client, auth_headers, test_event):
    r = client.post(
        f"/api/events/{test_event.code}/bulk-review",
        json={"action": "launch_nukes"},
        headers=auth_headers,
    )
    assert r.status_code == 422
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd server && .venv/bin/pytest tests/test_collect_dj.py -v -k "bulk"`
Expected: FAIL.

- [ ] **Step 3: Add the endpoint**

Add imports to `server/app/api/events.py`:

```python
from app.schemas.collect import BulkReviewRequest, BulkReviewResponse
```

Add endpoint:

```python
@router.post("/{code}/bulk-review", response_model=BulkReviewResponse)
def bulk_review(
    code: str,
    payload: BulkReviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    event = db.query(Event).filter(Event.code == code).one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.created_by_user_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")

    from app.models.request import Request as SongRequest

    pending_q = (
        db.query(SongRequest)
        .filter(SongRequest.event_id == event.id)
        .filter(SongRequest.submitted_during_collection == True)  # noqa: E712
        .filter(SongRequest.status == "new")
    )

    accepted = 0
    rejected = 0

    if payload.action == "accept_top_n":
        if payload.n is None:
            raise HTTPException(status_code=400, detail="n is required")
        rows = (
            pending_q.order_by(
                SongRequest.vote_count.desc(), SongRequest.created_at.asc()
            )
            .limit(payload.n)
            .all()
        )
        for r in rows:
            r.status = "accepted"
            accepted += 1
    elif payload.action == "accept_threshold":
        if payload.min_votes is None:
            raise HTTPException(status_code=400, detail="min_votes is required")
        rows = pending_q.filter(SongRequest.vote_count >= payload.min_votes).all()
        for r in rows:
            r.status = "accepted"
            accepted += 1
    elif payload.action == "accept_ids":
        if not payload.request_ids:
            raise HTTPException(status_code=400, detail="request_ids is required")
        rows = pending_q.filter(SongRequest.id.in_(payload.request_ids)).all()
        for r in rows:
            r.status = "accepted"
            accepted += 1
    elif payload.action == "reject_ids":
        if not payload.request_ids:
            raise HTTPException(status_code=400, detail="request_ids is required")
        rows = pending_q.filter(SongRequest.id.in_(payload.request_ids)).all()
        for r in rows:
            r.status = "rejected"
            rejected += 1
    elif payload.action == "reject_remaining":
        rows = pending_q.all()
        for r in rows:
            r.status = "rejected"
            rejected += 1

    db.commit()
    return BulkReviewResponse(accepted=accepted, rejected=rejected, unchanged=0)
```

- [ ] **Step 4: Run tests**

Run: `cd server && .venv/bin/pytest tests/test_collect_dj.py -v`
Expected: 14 passed (8 + 6 new).

- [ ] **Step 5: Run full backend test suite + alembic drift check**

Run: `cd server && .venv/bin/pytest -q && .venv/bin/alembic upgrade head && .venv/bin/alembic check`
Expected: all green, no drift.

- [ ] **Step 6: Commit**

```bash
git add server/app/api/events.py server/tests/test_collect_dj.py
git commit -m "feat(collect): POST /events/{code}/bulk-review with all action types"
```

---

## Task 13: Frontend API client — collect methods

**Files:**
- Modify: `dashboard/lib/api.ts`
- Create: `dashboard/lib/__tests__/collect-api.test.ts`

- [ ] **Step 1: Write failing tests**

Create `dashboard/lib/__tests__/collect-api.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { apiClient } from "../api";

const OK_RESPONSE = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

describe("collect api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getCollectEvent issues GET /api/public/collect/{code}", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      OK_RESPONSE({ code: "ABC", phase: "collection" })
    );
    const r = await apiClient.getCollectEvent("ABC");
    expect(r.phase).toBe("collection");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/public\/collect\/ABC$/),
      expect.objectContaining({ method: "GET" })
    );
  });

  it("submitCollectRequest POSTs JSON", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      OK_RESPONSE({ id: 42 })
    );
    await apiClient.submitCollectRequest("ABC", {
      song_title: "T",
      artist: "A",
      source: "spotify",
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/public\/collect\/ABC\/requests$/),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("voteCollectRequest POSTs the request_id", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      OK_RESPONSE({ ok: true })
    );
    await apiClient.voteCollectRequest("ABC", 99);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/public\/collect\/ABC\/vote$/),
      expect.objectContaining({
        body: JSON.stringify({ request_id: 99 }),
      })
    );
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd dashboard && npm test -- --run lib/__tests__/collect-api.test.ts`
Expected: FAIL — methods not defined.

- [ ] **Step 3: Add the methods to `apiClient` in `dashboard/lib/api.ts`**

First read the existing `apiClient` class to match its style (methods, base URL, headers). Then add the following methods to the class (paste inside the class body):

```typescript
  // ===== Pre-Event Collection =====

  async getCollectEvent(code: string): Promise<CollectEventPreview> {
    const res = await fetch(`${this.baseUrl}/api/public/collect/${code}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`getCollectEvent failed: ${res.status}`);
    return res.json();
  }

  async getCollectLeaderboard(
    code: string,
    tab: "trending" | "all" = "trending"
  ): Promise<CollectLeaderboardResponse> {
    const res = await fetch(
      `${this.baseUrl}/api/public/collect/${code}/leaderboard?tab=${tab}`,
      { method: "GET", headers: { "Content-Type": "application/json" } }
    );
    if (!res.ok) throw new Error(`getCollectLeaderboard failed: ${res.status}`);
    return res.json();
  }

  async setCollectProfile(
    code: string,
    data: { nickname?: string; email?: string }
  ): Promise<CollectProfileResponse> {
    const res = await fetch(`${this.baseUrl}/api/public/collect/${code}/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`setCollectProfile failed: ${res.status}`);
    return res.json();
  }

  async getCollectMyPicks(code: string): Promise<CollectMyPicksResponse> {
    const res = await fetch(`${this.baseUrl}/api/public/collect/${code}/profile/me`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`getCollectMyPicks failed: ${res.status}`);
    return res.json();
  }

  async submitCollectRequest(
    code: string,
    data: {
      song_title: string;
      artist: string;
      source: "spotify" | "beatport" | "tidal" | "manual";
      source_url?: string;
      artwork_url?: string;
      note?: string;
      nickname?: string;
    }
  ): Promise<{ id: number }> {
    const res = await fetch(`${this.baseUrl}/api/public/collect/${code}/requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.detail ?? "Submit failed");
    }
    return res.json();
  }

  async voteCollectRequest(code: string, requestId: number): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/public/collect/${code}/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: requestId }),
    });
    if (!res.ok) throw new ApiError(res.status, "Vote failed");
  }

  // --- DJ-side ---

  async patchCollectionSettings(
    code: string,
    data: {
      collection_opens_at?: string | null;
      live_starts_at?: string | null;
      submission_cap_per_guest?: number;
      collection_phase_override?: "force_collection" | "force_live" | null;
    }
  ): Promise<CollectionSettingsResponse> {
    return this.fetch(`/events/${code}/collection`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async getPendingReview(code: string): Promise<PendingReviewResponse> {
    return this.fetch(`/events/${code}/pending-review`);
  }

  async bulkReview(
    code: string,
    data: {
      action:
        | "accept_top_n"
        | "accept_threshold"
        | "accept_ids"
        | "reject_ids"
        | "reject_remaining";
      n?: number;
      min_votes?: number;
      request_ids?: number[];
    }
  ): Promise<BulkReviewResponse> {
    return this.fetch(`/events/${code}/bulk-review`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }
```

Add these TypeScript types to the file (near existing types):

```typescript
export interface CollectEventPreview {
  code: string;
  name: string;
  banner_filename: string | null;
  submission_cap_per_guest: number;
  registration_enabled: boolean;
  phase: "pre_announce" | "collection" | "live" | "closed";
  collection_opens_at: string | null;
  live_starts_at: string | null;
  expires_at: string;
}

export interface CollectLeaderboardRow {
  id: number;
  title: string;
  artist: string;
  artwork_url: string | null;
  vote_count: number;
  nickname: string | null;
  status: "new" | "accepted" | "playing" | "played" | "rejected";
  created_at: string;
}

export interface CollectLeaderboardResponse {
  requests: CollectLeaderboardRow[];
  total: number;
}

export interface CollectProfileResponse {
  nickname: string | null;
  has_email: boolean;
  submission_count: number;
  submission_cap: number;
}

export interface CollectMyPicksItem extends CollectLeaderboardRow {
  interaction: "submitted" | "upvoted";
}

export interface CollectMyPicksResponse {
  submitted: CollectMyPicksItem[];
  upvoted: CollectMyPicksItem[];
  is_top_contributor: boolean;
  first_suggestion_ids: number[];
}

export interface CollectionSettingsResponse {
  collection_opens_at: string | null;
  live_starts_at: string | null;
  submission_cap_per_guest: number;
  collection_phase_override: "force_collection" | "force_live" | null;
  phase: "pre_announce" | "collection" | "live" | "closed";
}

export interface PendingReviewRow {
  id: number;
  song_title: string;
  artist: string;
  artwork_url: string | null;
  vote_count: number;
  nickname: string | null;
  created_at: string;
  note: string | null;
  status: "new" | "accepted" | "playing" | "played" | "rejected";
}

export interface PendingReviewResponse {
  requests: PendingReviewRow[];
  total: number;
}

export interface BulkReviewResponse {
  accepted: number;
  rejected: number;
  unchanged: number;
}
```

If `ApiError` doesn't exist in the file, use a plain `Error` throw and adjust the tests accordingly.

- [ ] **Step 4: Run frontend tests + tsc**

Run: `cd dashboard && npx tsc --noEmit && npm test -- --run lib/__tests__/collect-api.test.ts`
Expected: tsc passes; vitest 3 passed.

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/api.ts dashboard/lib/__tests__/collect-api.test.ts
git commit -m "feat(collect): frontend api client methods"
```

---

## Task 14: `/collect/[code]` page scaffold + phase routing

**Files:**
- Create: `dashboard/app/collect/[code]/page.tsx`
- Create: `dashboard/app/collect/[code]/page.test.tsx`
- Create: `dashboard/app/collect/[code]/components/` (directory)

- [ ] **Step 1: Write failing test**

Create `dashboard/app/collect/[code]/page.test.tsx`:

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import CollectPage from "./page";

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  useParams: () => ({ code: "ABC" }),
}));

const mockGetEvent = vi.fn();
vi.mock("../../../lib/api", () => ({
  apiClient: {
    getCollectEvent: (...a: unknown[]) => mockGetEvent(...a),
    getCollectLeaderboard: vi.fn().mockResolvedValue({ requests: [], total: 0 }),
    getCollectMyPicks: vi.fn().mockResolvedValue({
      submitted: [], upvoted: [], is_top_contributor: false, first_suggestion_ids: []
    }),
  },
}));

describe("CollectPage", () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockGetEvent.mockReset();
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows pre-announce countdown when phase is pre_announce", async () => {
    mockGetEvent.mockResolvedValue({
      code: "ABC",
      name: "Test Event",
      phase: "pre_announce",
      collection_opens_at: new Date(Date.now() + 3600_000).toISOString(),
      live_starts_at: new Date(Date.now() + 7200_000).toISOString(),
      submission_cap_per_guest: 15,
      banner_filename: null,
      registration_enabled: true,
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
    });
    render(<CollectPage />);
    await waitFor(() => {
      expect(screen.getByText(/opens in/i)).toBeInTheDocument();
    });
  });

  it("renders collection experience when phase is collection", async () => {
    mockGetEvent.mockResolvedValue({
      code: "ABC",
      name: "Test Event",
      phase: "collection",
      collection_opens_at: new Date(Date.now() - 3600_000).toISOString(),
      live_starts_at: new Date(Date.now() + 3600_000).toISOString(),
      submission_cap_per_guest: 15,
      banner_filename: null,
      registration_enabled: true,
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
    });
    render(<CollectPage />);
    await waitFor(() => {
      expect(screen.getByText(/test event/i)).toBeInTheDocument();
    });
  });

  it("redirects to /join when phase is live", async () => {
    mockGetEvent.mockResolvedValue({
      code: "ABC",
      name: "Test Event",
      phase: "live",
      collection_opens_at: new Date(Date.now() - 86400_000).toISOString(),
      live_starts_at: new Date(Date.now() - 3600_000).toISOString(),
      submission_cap_per_guest: 15,
      banner_filename: null,
      registration_enabled: true,
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
    });
    render(<CollectPage />);
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/join/ABC");
    });
    expect(sessionStorage.setItem).toHaveBeenCalledWith(
      "wrzdj_live_splash_ABC",
      "1"
    );
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd dashboard && npm test -- --run app/collect`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the page**

Create `dashboard/app/collect/[code]/page.tsx`:

```typescript
"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  apiClient,
  CollectEventPreview,
  CollectLeaderboardResponse,
  CollectMyPicksResponse,
} from "../../../lib/api";

const POLL_MS = 5000;

export default function CollectPage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const code = params?.code ?? "";
  const [event, setEvent] = useState<CollectEventPreview | null>(null);
  const [leaderboard, setLeaderboard] = useState<CollectLeaderboardResponse | null>(
    null
  );
  const [myPicks, setMyPicks] = useState<CollectMyPicksResponse | null>(null);
  const [tab, setTab] = useState<"trending" | "all">("trending");
  const [error, setError] = useState<string | null>(null);

  const redirectToJoin = () => {
    sessionStorage.setItem(`wrzdj_live_splash_${code}`, "1");
    router.replace(`/join/${code}`);
  };

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const ev = await apiClient.getCollectEvent(code);
        if (cancelled) return;
        setEvent(ev);
        if (ev.phase === "live" || ev.phase === "closed") {
          redirectToJoin();
          return;
        }
        if (ev.phase === "collection") {
          const [lb, picks] = await Promise.all([
            apiClient.getCollectLeaderboard(code, tab),
            apiClient.getCollectMyPicks(code),
          ]);
          if (!cancelled) {
            setLeaderboard(lb);
            setMyPicks(picks);
          }
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
      if (!cancelled && document.visibilityState === "visible") {
        timer = setTimeout(tick, POLL_MS);
      }
    };

    tick();
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !cancelled) tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [code, tab]);

  if (error) return <main style={{ padding: 24 }}>Error: {error}</main>;
  if (!event) return <main style={{ padding: 24 }}>Loading…</main>;

  if (event.phase === "pre_announce") {
    const opens = event.collection_opens_at
      ? new Date(event.collection_opens_at)
      : null;
    return (
      <main style={{ padding: 24 }}>
        <h1>{event.name}</h1>
        <p>Voting opens in {formatCountdown(opens)}</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>{event.name}</h1>
      <p>Voting open — {formatCountdown(event.live_starts_at ? new Date(event.live_starts_at) : null)} until the event goes live</p>
      <div style={{ marginTop: 16 }}>
        <button onClick={() => setTab("trending")} aria-pressed={tab === "trending"}>
          Trending
        </button>
        <button onClick={() => setTab("all")} aria-pressed={tab === "all"}>
          All
        </button>
      </div>
      <ul>
        {leaderboard?.requests.map((r) => (
          <li key={r.id}>
            <strong>{r.title}</strong> — {r.artist} (▲ {r.vote_count})
          </li>
        ))}
      </ul>
      <section>
        <h2>My Picks</h2>
        {myPicks?.submitted.length === 0 && myPicks?.upvoted.length === 0 ? (
          <p>No picks yet — search for a song below!</p>
        ) : (
          <ul>
            {myPicks?.submitted.map((r) => (
              <li key={`s-${r.id}`}>
                {r.title} — {r.artist} [{r.status}]
              </li>
            ))}
            {myPicks?.upvoted.map((r) => (
              <li key={`u-${r.id}`}>
                {r.title} — {r.artist} (upvoted)
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function formatCountdown(target: Date | null): string {
  if (!target) return "";
  const diff = target.getTime() - Date.now();
  if (diff <= 0) return "now";
  const hrs = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  const days = Math.floor(hrs / 24);
  if (days >= 1) return `${days}d ${hrs % 24}h`;
  return `${hrs}h ${mins}m`;
}
```

- [ ] **Step 4: Run tests**

Run: `cd dashboard && npx tsc --noEmit && npm test -- --run app/collect/[code]/page.test.tsx`
Expected: tsc passes; vitest 3 passed.

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/collect/[code]/page.tsx dashboard/app/collect/[code]/page.test.tsx
git commit -m "feat(collect): /collect/[code] page scaffold with phase-aware routing"
```

---

## Task 15: FeatureOptInPanel component + email opt-in flow

**Files:**
- Create: `dashboard/app/collect/[code]/components/FeatureOptInPanel.tsx`
- Create: `dashboard/app/collect/[code]/components/FeatureOptInPanel.test.tsx`
- Modify: `dashboard/app/collect/[code]/page.tsx`

- [ ] **Step 1: Write failing test**

Create `dashboard/app/collect/[code]/components/FeatureOptInPanel.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FeatureOptInPanel from "./FeatureOptInPanel";

describe("FeatureOptInPanel", () => {
  it("does not render when hasEmail is true", () => {
    render(<FeatureOptInPanel hasEmail={true} onSave={vi.fn()} />);
    expect(screen.queryByText(/add email/i)).not.toBeInTheDocument();
  });

  it("shows feature comparison and save button", () => {
    render(<FeatureOptInPanel hasEmail={false} onSave={vi.fn()} />);
    expect(screen.getByText(/notify me when my song plays/i)).toBeInTheDocument();
    expect(screen.getByText(/cross-device/i)).toBeInTheDocument();
  });

  it("rejects invalid email on client", async () => {
    const onSave = vi.fn();
    render(<FeatureOptInPanel hasEmail={false} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "bogus" } });
    fireEvent.click(screen.getByRole("button", { name: /add email/i }));
    await waitFor(() => {
      expect(screen.getByText(/invalid email/i)).toBeInTheDocument();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("calls onSave with valid email", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FeatureOptInPanel hasEmail={false} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "guest@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add email/i }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("guest@example.com");
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd dashboard && npm test -- --run app/collect/[code]/components/FeatureOptInPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `dashboard/app/collect/[code]/components/FeatureOptInPanel.tsx`:

```typescript
"use client";

import { useState } from "react";
import { z } from "zod";

const emailSchema = z.string().email().max(254);

interface Props {
  hasEmail: boolean;
  onSave: (email: string) => Promise<void>;
}

export default function FeatureOptInPanel({ hasEmail, onSave }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (hasEmail || !expanded) return null;

  const submit = async () => {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError("Invalid email");
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed.data);
      setExpanded(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      style={{
        background: "#1a1a1a",
        padding: 16,
        borderRadius: 8,
        marginBottom: 16,
      }}
    >
      <h3>Get the most out of your picks</h3>
      <ul style={{ marginBottom: 12 }}>
        <li>Notify me when my song plays</li>
        <li>Cross-device &quot;my picks&quot; and leaderboard position</li>
        <li>Persistent profile across events</li>
      </ul>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ marginLeft: 8 }}
        />
      </label>
      {error && <p style={{ color: "#ff6b6b" }}>{error}</p>}
      <div style={{ marginTop: 8 }}>
        <button onClick={() => setExpanded(false)} disabled={saving}>
          Keep it anonymous
        </button>
        <button onClick={submit} disabled={saving}>
          Add email
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Wire it into `page.tsx`**

In `dashboard/app/collect/[code]/page.tsx`, add the import and a local `hasEmail` state sourced from a new `profile` state. Add this inside the component (near other state hooks):

```typescript
import FeatureOptInPanel from "./components/FeatureOptInPanel";

// inside CollectPage:
const [hasEmail, setHasEmail] = useState(false);

const saveEmail = async (email: string) => {
  const resp = await apiClient.setCollectProfile(code, { email });
  setHasEmail(resp.has_email);
};
```

In the collection-phase render block (right above the tabs), insert:

```tsx
<FeatureOptInPanel hasEmail={hasEmail} onSave={saveEmail} />
```

- [ ] **Step 5: Run tests**

Run: `cd dashboard && npx tsc --noEmit && npm test -- --run app/collect`
Expected: tsc green, all vitest green.

- [ ] **Step 6: Commit**

```bash
git add dashboard/app/collect/[code]/components/FeatureOptInPanel.tsx dashboard/app/collect/[code]/components/FeatureOptInPanel.test.tsx dashboard/app/collect/[code]/page.tsx
git commit -m "feat(collect): feature opt-in panel with zod email validation"
```

---

## Task 16: LeaderboardTabs component with optimistic vote

**Files:**
- Create: `dashboard/app/collect/[code]/components/LeaderboardTabs.tsx`
- Create: `dashboard/app/collect/[code]/components/LeaderboardTabs.test.tsx`
- Modify: `dashboard/app/collect/[code]/page.tsx`

- [ ] **Step 1: Write failing test**

Create `dashboard/app/collect/[code]/components/LeaderboardTabs.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LeaderboardTabs from "./LeaderboardTabs";

const rows = [
  { id: 1, title: "A", artist: "X", artwork_url: null, vote_count: 5, nickname: "alex", status: "new" as const, created_at: "2026-04-21" },
  { id: 2, title: "B", artist: "Y", artwork_url: null, vote_count: 1, nickname: "jo",   status: "new" as const, created_at: "2026-04-21" },
];

describe("LeaderboardTabs", () => {
  it("renders rows and switches tabs", () => {
    const onTabChange = vi.fn();
    render(
      <LeaderboardTabs
        rows={rows}
        tab="trending"
        onTabChange={onTabChange}
        onVote={vi.fn()}
      />
    );
    expect(screen.getByText("A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^all$/i }));
    expect(onTabChange).toHaveBeenCalledWith("all");
  });

  it("optimistically updates vote count then rolls back on error", async () => {
    const onVote = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <LeaderboardTabs
        rows={rows}
        tab="trending"
        onTabChange={vi.fn()}
        onVote={onVote}
      />
    );
    fireEvent.click(screen.getAllByRole("button", { name: /upvote/i })[0]);
    await waitFor(() => {
      expect(screen.getByText(/5/)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd dashboard && npm test -- --run app/collect/[code]/components/LeaderboardTabs.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

Create `dashboard/app/collect/[code]/components/LeaderboardTabs.tsx`:

```typescript
"use client";

import { useState } from "react";
import type { CollectLeaderboardRow } from "../../../../lib/api";

interface Props {
  rows: CollectLeaderboardRow[];
  tab: "trending" | "all";
  onTabChange: (tab: "trending" | "all") => void;
  onVote: (requestId: number) => Promise<void>;
}

export default function LeaderboardTabs({ rows, tab, onTabChange, onVote }: Props) {
  const [optimistic, setOptimistic] = useState<Record<number, number>>({});

  const handleVote = async (id: number, currentVotes: number) => {
    setOptimistic((o) => ({ ...o, [id]: currentVotes + 1 }));
    try {
      await onVote(id);
    } catch {
      setOptimistic((o) => {
        const next = { ...o };
        delete next[id];
        return next;
      });
    }
  };

  return (
    <div>
      <div role="tablist" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          role="tab"
          aria-pressed={tab === "trending"}
          onClick={() => onTabChange("trending")}
        >
          Trending
        </button>
        <button
          role="tab"
          aria-pressed={tab === "all"}
          onClick={() => onTabChange("all")}
        >
          All
        </button>
      </div>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {rows.map((r) => {
          const votes = optimistic[r.id] ?? r.vote_count;
          return (
            <li
              key={r.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: 8,
                background: "#1a1a1a",
                marginBottom: 4,
              }}
            >
              <div>
                <strong>{r.title}</strong> — {r.artist}
                {r.nickname && <span style={{ opacity: 0.7 }}> · by @{r.nickname}</span>}
              </div>
              <button
                aria-label="upvote"
                onClick={() => handleVote(r.id, r.vote_count)}
              >
                ▲ {votes}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Wire into `page.tsx`**

Replace the inline `<ul>` and buttons in `page.tsx` with:

```tsx
<LeaderboardTabs
  rows={leaderboard?.requests ?? []}
  tab={tab}
  onTabChange={setTab}
  onVote={(id) => apiClient.voteCollectRequest(code, id)}
/>
```

And import at top:

```typescript
import LeaderboardTabs from "./components/LeaderboardTabs";
```

- [ ] **Step 5: Run tests + tsc**

Run: `cd dashboard && npx tsc --noEmit && npm test -- --run app/collect`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add dashboard/app/collect/[code]/components/LeaderboardTabs.tsx dashboard/app/collect/[code]/components/LeaderboardTabs.test.tsx dashboard/app/collect/[code]/page.tsx
git commit -m "feat(collect): LeaderboardTabs with optimistic vote"
```

---

## Task 17: MyPicksPanel with status + gamification badges

**Files:**
- Create: `dashboard/app/collect/[code]/components/MyPicksPanel.tsx`
- Create: `dashboard/app/collect/[code]/components/MyPicksPanel.test.tsx`
- Modify: `dashboard/app/collect/[code]/page.tsx`

- [ ] **Step 1: Write failing test**

Create `dashboard/app/collect/[code]/components/MyPicksPanel.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MyPicksPanel from "./MyPicksPanel";

const basePick = {
  id: 1,
  title: "Mr. Brightside",
  artist: "The Killers",
  artwork_url: null,
  vote_count: 12,
  nickname: "me",
  status: "new" as const,
  created_at: "2026-04-21T00:00:00Z",
  interaction: "submitted" as const,
};

describe("MyPicksPanel", () => {
  it("shows empty state when no picks", () => {
    render(
      <MyPicksPanel
        picks={{ submitted: [], upvoted: [], is_top_contributor: false, first_suggestion_ids: [] }}
      />
    );
    expect(screen.getByText(/no picks yet/i)).toBeInTheDocument();
  });

  it("shows top contributor badge when flagged", () => {
    render(
      <MyPicksPanel
        picks={{
          submitted: [basePick],
          upvoted: [],
          is_top_contributor: true,
          first_suggestion_ids: [],
        }}
      />
    );
    expect(screen.getByText(/top contributor/i)).toBeInTheDocument();
  });

  it("shows first-to-suggest badge on matching pick", () => {
    render(
      <MyPicksPanel
        picks={{
          submitted: [basePick],
          upvoted: [],
          is_top_contributor: false,
          first_suggestion_ids: [1],
        }}
      />
    );
    expect(screen.getByText(/first to suggest/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd dashboard && npm test -- --run app/collect/[code]/components/MyPicksPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `dashboard/app/collect/[code]/components/MyPicksPanel.tsx`:

```typescript
"use client";

import type { CollectMyPicksResponse } from "../../../../lib/api";

interface Props {
  picks: CollectMyPicksResponse;
}

export default function MyPicksPanel({ picks }: Props) {
  const isEmpty = picks.submitted.length === 0 && picks.upvoted.length === 0;

  return (
    <section style={{ marginTop: 24 }}>
      <h2>My Picks</h2>
      {picks.is_top_contributor && (
        <p style={{ color: "#ffcc00" }}>🏆 Top contributor for this event</p>
      )}
      {isEmpty ? (
        <p>No picks yet — search for a song below!</p>
      ) : (
        <ul>
          {picks.submitted.map((p) => (
            <li key={`s-${p.id}`}>
              {p.title} — {p.artist}
              <span style={{ marginLeft: 8, padding: "2px 6px", background: "#333" }}>
                {p.status}
              </span>
              {picks.first_suggestion_ids.includes(p.id) && (
                <span style={{ marginLeft: 8 }}>⭐ First to suggest</span>
              )}
            </li>
          ))}
          {picks.upvoted.map((p) => (
            <li key={`u-${p.id}`}>
              {p.title} — {p.artist} <em>(upvoted)</em>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Replace the inline My Picks in `page.tsx`**

Replace the inline `<section><h2>My Picks</h2>…</section>` in `page.tsx` with:

```tsx
{myPicks && <MyPicksPanel picks={myPicks} />}
```

And add the import.

- [ ] **Step 5: Run tests + tsc**

Run: `cd dashboard && npx tsc --noEmit && npm test -- --run app/collect`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add dashboard/app/collect/[code]/components/MyPicksPanel.tsx dashboard/app/collect/[code]/components/MyPicksPanel.test.tsx dashboard/app/collect/[code]/page.tsx
git commit -m "feat(collect): MyPicksPanel with status + gamification badges"
```

---

## Task 18: Sticky submit button + cap counter + search wrapper

**Files:**
- Create: `dashboard/app/collect/[code]/components/SubmitBar.tsx`
- Create: `dashboard/app/collect/[code]/components/SubmitBar.test.tsx`
- Modify: `dashboard/app/collect/[code]/page.tsx`

- [ ] **Step 1: Write failing test**

Create `dashboard/app/collect/[code]/components/SubmitBar.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SubmitBar from "./SubmitBar";

describe("SubmitBar", () => {
  it("shows used vs cap", () => {
    render(
      <SubmitBar used={3} cap={15} onOpenSearch={vi.fn()} />
    );
    expect(screen.getByText(/3 of 15 picks used/i)).toBeInTheDocument();
  });

  it("disables button at cap", () => {
    render(
      <SubmitBar used={15} cap={15} onOpenSearch={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: /Request a song/i })).toBeDisabled();
  });

  it("button enabled when cap is 0 (unlimited)", () => {
    render(
      <SubmitBar used={99} cap={0} onOpenSearch={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: /Request a song/i })).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd dashboard && npm test -- --run app/collect/[code]/components/SubmitBar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `dashboard/app/collect/[code]/components/SubmitBar.tsx`:

```typescript
"use client";

interface Props {
  used: number;
  cap: number; // 0 means unlimited
  onOpenSearch: () => void;
}

export default function SubmitBar({ used, cap, onOpenSearch }: Props) {
  const atCap = cap !== 0 && used >= cap;
  const label =
    cap === 0 ? "Unlimited picks" : `${used} of ${cap} picks used`;

  return (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        background: "#0a0a0a",
        padding: 16,
        borderTop: "1px solid #333",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span>{label}</span>
      <button disabled={atCap} onClick={onOpenSearch}>
        + Request a song
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Wire into `page.tsx`**

Fetch the profile on load (to get `submission_count` + `submission_cap`). Add a `profile` state + a call to `apiClient.setCollectProfile(code, {})` on first visit (to create/load the profile). Then pass `used={profile?.submission_count ?? 0}` and `cap={event.submission_cap_per_guest}`.

For the search flow, reuse the existing `/join/[code]` search UX by importing from its components folder. For now, wire `onOpenSearch` to a stub that calls `apiClient.submitCollectRequest` with a mocked payload for integration-testing. A full search modal is out of scope of this task — it's handled in Task 19.

Add to `page.tsx`:

```typescript
import SubmitBar from "./components/SubmitBar";
// …
const [profile, setProfile] = useState<{ submission_count: number; submission_cap: number } | null>(null);

useEffect(() => {
  if (!code) return;
  apiClient.setCollectProfile(code, {}).then((p) => {
    setProfile({ submission_count: p.submission_count, submission_cap: p.submission_cap });
    setHasEmail(p.has_email);
  });
}, [code]);
```

And in the collection-phase render:

```tsx
<SubmitBar
  used={profile?.submission_count ?? 0}
  cap={event.submission_cap_per_guest}
  onOpenSearch={() => alert("Song search coming in Task 19")}
/>
```

- [ ] **Step 5: Run tests**

Run: `cd dashboard && npx tsc --noEmit && npm test -- --run app/collect`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add dashboard/app/collect/[code]/components/SubmitBar.tsx dashboard/app/collect/[code]/components/SubmitBar.test.tsx dashboard/app/collect/[code]/page.tsx
git commit -m "feat(collect): submit bar with cap counter"
```

---

## Task 19: Integrate existing search modal for song submission

**Files:**
- Modify: `dashboard/app/collect/[code]/page.tsx`

- [ ] **Step 1: Locate the existing join-page search flow**

Run: `grep -rn "search.*songs\|SongSearch\|searchSongs" /home/adam/github/WrzDJ/dashboard/app/join/ | head -20`

Identify the component/hook used on `/join/[code]` to render the search UI and produce a selected track. Examples: `dashboard/app/join/[code]/components/SongSearch.tsx`, or a hook that calls `apiClient.searchSongs()`.

- [ ] **Step 2: Reuse or adapt**

If the search component is reusable as-is: import it. If it's tightly coupled to the join page, extract a shared version:
- Move shared search UI to `dashboard/components/SongSearchModal.tsx` (or equivalent path)
- Both `/join/[code]` and `/collect/[code]` import from the shared location

Check what exists with `grep` before making an extraction. If extraction is simplest, keep the commit limited to: (a) move + import-path updates on `/join`, (b) import on `/collect`, (c) no functional changes elsewhere.

- [ ] **Step 3: Wire the search flow on the collect page**

In `page.tsx`, replace the stub `onOpenSearch` with a proper handler that opens the modal. On track-select, call:

```typescript
await apiClient.submitCollectRequest(code, {
  song_title: selected.title,
  artist: selected.artist,
  source: selected.source,
  source_url: selected.source_url,
  artwork_url: selected.artwork_url,
  nickname: localStorage.getItem(`wrzdj_collect_nickname_${code}`) ?? undefined,
});
// refresh profile + leaderboard
const p = await apiClient.setCollectProfile(code, {});
setProfile({ submission_count: p.submission_count, submission_cap: p.submission_cap });
const lb = await apiClient.getCollectLeaderboard(code, tab);
setLeaderboard(lb);
```

Handle `ApiError(429)` → show "Picks limit reached" toast (reuse existing toast pattern — grep for it).

- [ ] **Step 4: Write an end-to-end unit test for the submit flow**

Append to `dashboard/app/collect/[code]/page.test.tsx`:

```typescript
it("increments picks counter after a successful submission", async () => {
  // set up mocks for getCollectEvent = collection, setCollectProfile returning 0 then 1
  // simulate search select, assert submitCollectRequest called, then profile refetched
});
```

Write the body using whichever mock-library pattern the other tests use (vi.mock for `apiClient`). Mock `apiClient.submitCollectRequest` to resolve with `{id: 100}` and `apiClient.setCollectProfile` to return `{submission_count: 1, submission_cap: 15, has_email: false, nickname: null}` on the second call.

- [ ] **Step 5: Run tests**

Run: `cd dashboard && npx tsc --noEmit && npm test -- --run app/collect`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(collect): reuse existing search modal for song submission"
```

---

## Task 20: /join/[code] soft banner linking to /collect/[code]

**Files:**
- Modify: `dashboard/app/join/[code]/page.tsx`

- [ ] **Step 1: Read the existing join page to find the best insert point**

Run: `wc -l /home/adam/github/WrzDJ/dashboard/app/join/[code]/page.tsx && sed -n '1,60p' /home/adam/github/WrzDJ/dashboard/app/join/[code]/page.tsx`

Locate where event data is loaded and where the top of the body renders.

- [ ] **Step 2: Add phase-aware banner + splash consumption**

Near the top of the component body, add:

```typescript
const [splashVisible, setSplashVisible] = useState(false);
useEffect(() => {
  if (typeof window === "undefined") return;
  const key = `wrzdj_live_splash_${code}`;
  if (sessionStorage.getItem(key) === "1") {
    setSplashVisible(true);
    sessionStorage.removeItem(key);
    setTimeout(() => setSplashVisible(false), 3000);
  }
}, [code]);
```

And in the render:

```tsx
{splashVisible && (
  <div style={{ padding: 12, background: "#ffcc00", color: "#000", textAlign: "center" }}>
    🎉 The event is now live — you&apos;re in!
  </div>
)}
{event?.phase === "pre_announce" || event?.phase === "collection" ? (
  <div style={{ padding: 12, background: "#1a1a1a", textAlign: "center" }}>
    Voting for this event is open —
    <a href={`/collect/${code}`}> go to the pre-event page →</a>
  </div>
) : null}
```

Note: the join page's event fetch likely returns a partial event without `phase`. If so, fetch the `/api/public/collect/{code}` endpoint here in parallel (cheap, cached) or expose `phase` on the existing public endpoint — pick whichever requires the smallest change. Prefer the parallel fetch to keep blast radius small.

- [ ] **Step 3: Verify by running lint + tsc**

Run: `cd dashboard && npm run lint && npx tsc --noEmit`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/join/[code]/page.tsx
git commit -m "feat(join): soft banner + splash for pre-event collection"
```

---

## Task 21: PreEventVotingTab — stats, phase controls, share link

**Files:**
- Create: `dashboard/app/events/[code]/components/PreEventVotingTab.tsx`
- Create: `dashboard/app/events/[code]/components/__tests__/PreEventVotingTab.test.tsx`
- Modify: `dashboard/app/events/[code]/page.tsx`

- [ ] **Step 1: Inspect how existing tabs are wired**

Run: `grep -n "SongManagementTab\|EventManagementTab" /home/adam/github/WrzDJ/dashboard/app/events/[code]/page.tsx`

Read 30 lines around those usages to understand the tab-rendering pattern.

- [ ] **Step 2: Write failing test**

Create `dashboard/app/events/[code]/components/__tests__/PreEventVotingTab.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PreEventVotingTab from "../PreEventVotingTab";

const baseEvent = {
  code: "ABC",
  name: "Wedding",
  collection_opens_at: "2026-04-21T12:00:00Z",
  live_starts_at: "2026-04-22T20:00:00Z",
  submission_cap_per_guest: 15,
  collection_phase_override: null,
  phase: "collection" as const,
};

vi.mock("../../../../lib/api", () => ({
  apiClient: {
    patchCollectionSettings: vi.fn().mockResolvedValue({ ...baseEvent, collection_phase_override: "force_live", phase: "live" }),
    getPendingReview: vi.fn().mockResolvedValue({ requests: [], total: 0 }),
    bulkReview: vi.fn(),
  },
}));

describe("PreEventVotingTab", () => {
  it("renders phase and share link", () => {
    render(<PreEventVotingTab event={baseEvent} onEventChange={vi.fn()} />);
    expect(screen.getByText(/phase:\s*collection/i)).toBeInTheDocument();
    expect(
      screen.getByText(/\/collect\/ABC/i)
    ).toBeInTheDocument();
  });

  it("applies force_live override via button", async () => {
    const onEventChange = vi.fn();
    render(<PreEventVotingTab event={baseEvent} onEventChange={onEventChange} />);
    fireEvent.click(screen.getByRole("button", { name: /start live now/i }));
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    await waitFor(() => {
      expect(onEventChange).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 3: Implement**

Create `dashboard/app/events/[code]/components/PreEventVotingTab.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import { apiClient, PendingReviewRow } from "../../../../lib/api";

interface EventShape {
  code: string;
  name: string;
  collection_opens_at: string | null;
  live_starts_at: string | null;
  submission_cap_per_guest: number;
  collection_phase_override: "force_collection" | "force_live" | null;
  phase: "pre_announce" | "collection" | "live" | "closed";
}

interface Props {
  event: EventShape;
  onEventChange: (next: Partial<EventShape>) => void;
}

export default function PreEventVotingTab({ event, onEventChange }: Props) {
  const [pending, setPending] = useState<PendingReviewRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState<null | "force_collection" | "force_live" | "clear">(null);
  const [topN, setTopN] = useState(20);
  const [minVotes, setMinVotes] = useState(3);

  useEffect(() => {
    refresh();
  }, [event.code]);

  async function refresh() {
    const resp = await apiClient.getPendingReview(event.code);
    setPending(resp.requests);
  }

  async function applyOverride(value: "force_collection" | "force_live" | null) {
    const resp = await apiClient.patchCollectionSettings(event.code, {
      collection_phase_override: value,
    });
    onEventChange(resp);
    setConfirming(null);
  }

  async function bulk(action: string, extras: Record<string, unknown> = {}) {
    await apiClient.bulkReview(event.code, { action: action as any, ...extras });
    setSelected(new Set());
    refresh();
  }

  const shareUrl = typeof window !== "undefined"
    ? `${window.location.origin}/collect/${event.code}`
    : `/collect/${event.code}`;

  return (
    <div style={{ padding: 16 }}>
      <h2>Pre-Event Voting</h2>
      <p>Phase: {event.phase}</p>
      <p>
        Share link: <code>{shareUrl}</code>
        <button onClick={() => navigator.clipboard.writeText(shareUrl)}>Copy</button>
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setConfirming("force_collection")}>Open collection now</button>
        <button onClick={() => setConfirming("force_live")}>Start live now</button>
        <button onClick={() => setConfirming("clear")}>Clear override</button>
      </div>

      {confirming && (
        <div style={{ padding: 12, background: "#1a1a1a", marginBottom: 16 }}>
          <p>Confirm action: {confirming}</p>
          <button onClick={() => applyOverride(confirming === "clear" ? null : confirming)}>
            Confirm
          </button>
          <button onClick={() => setConfirming(null)}>Cancel</button>
        </div>
      )}

      <h3>Pending review ({pending.length})</h3>
      <div style={{ marginBottom: 8 }}>
        <label>
          Top N: <input type="number" value={topN} onChange={(e) => setTopN(Number(e.target.value))} />
          <button onClick={() => bulk("accept_top_n", { n: topN })}>Accept top N</button>
        </label>
        <label style={{ marginLeft: 16 }}>
          ≥ votes: <input type="number" value={minVotes} onChange={(e) => setMinVotes(Number(e.target.value))} />
          <button onClick={() => bulk("accept_threshold", { min_votes: minVotes })}>Accept threshold</button>
        </label>
        <button onClick={() => bulk("reject_remaining")} style={{ marginLeft: 16 }}>
          Reject remaining
        </button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th></th>
            <th>▲</th>
            <th>Song</th>
            <th>Artist</th>
            <th>Submitted by</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {pending.map((r) => (
            <tr key={r.id}>
              <td>
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(r.id); else next.delete(r.id);
                    setSelected(next);
                  }}
                />
              </td>
              <td>{r.vote_count}</td>
              <td>{r.song_title}</td>
              <td>{r.artist}</td>
              <td>{r.nickname ?? "—"}</td>
              <td>
                <button onClick={() => bulk("accept_ids", { request_ids: [r.id] })}>Accept</button>
                <button onClick={() => bulk("reject_ids", { request_ids: [r.id] })}>Reject</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {selected.size > 0 && (
        <div style={{ marginTop: 8 }}>
          <button onClick={() => bulk("accept_ids", { request_ids: Array.from(selected) })}>
            Accept selected ({selected.size})
          </button>
          <button onClick={() => bulk("reject_ids", { request_ids: Array.from(selected) })}>
            Reject selected ({selected.size})
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Register the tab in the event page**

Edit `dashboard/app/events/[code]/page.tsx`. Add import:

```typescript
import PreEventVotingTab from "./components/PreEventVotingTab";
```

Add a third tab entry that renders only when `event.collection_opens_at != null`. Match the existing tab-switching pattern. If tabs are driven by a `tab: string` local state variable with values like `"songs" | "event"`, extend to `"songs" | "event" | "pre-event"`.

- [ ] **Step 5: Run tests + tsc**

Run: `cd dashboard && npx tsc --noEmit && npm test -- --run app/events/[code]/components`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add dashboard/app/events/[code]/components/PreEventVotingTab.tsx dashboard/app/events/[code]/components/__tests__/PreEventVotingTab.test.tsx dashboard/app/events/[code]/page.tsx
git commit -m "feat(collect): PreEventVotingTab with bulk review + overrides"
```

---

## Task 22: Event create/edit form — collection section

**Files:**
- Modify: wherever the event-create form lives (`dashboard/app/events/new/page.tsx` likely; confirm with glob)
- Modify: wherever the event-edit form lives (likely inside `dashboard/app/events/[code]/components/EventCustomizationCard.tsx` or similar)

- [ ] **Step 1: Locate the forms**

Run: `grep -rn "create.*event\|createEvent\|/events/new" /home/adam/github/WrzDJ/dashboard/app/ | head -10`
Run: `grep -rn "editEvent\|patchEvent" /home/adam/github/WrzDJ/dashboard/ | head -10`

Identify both files.

- [ ] **Step 2: Add collapsible "Pre-event collection" section to both forms**

The section contains:
- Enable checkbox
- `collection_opens_at` — `<input type="datetime-local">`
- `live_starts_at` — `<input type="datetime-local">`
- `submission_cap_per_guest` — `<input type="number" min="0" max="100">`

Client-side zod validation before submit:

```typescript
import { z } from "zod";

const collectionSchema = z.object({
  collection_opens_at: z.string().optional(),
  live_starts_at: z.string().optional(),
  submission_cap_per_guest: z.number().int().min(0).max(100).optional(),
}).refine(
  (v) => {
    if (v.collection_opens_at && v.live_starts_at) {
      return new Date(v.collection_opens_at) < new Date(v.live_starts_at);
    }
    return true;
  },
  { message: "Collection opens must be before live starts" }
);
```

On submit: include these fields in the event create/update call. If the event-create endpoint doesn't yet accept them, call `PATCH /api/events/{code}/collection` after the event is created.

- [ ] **Step 3: Verify with tsc + lint**

Run: `cd dashboard && npm run lint && npx tsc --noEmit`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(collect): event create/edit form — pre-event collection section"
```

---

## Task 23: Security test suite — `~/wrzdj-testing/11-pre-event-collection.sh`

**Files:**
- Create: `~/wrzdj-testing/11-pre-event-collection.sh` (outside repo — user's machine)
- Modify: `~/wrzdj-testing/run-all.sh`

- [ ] **Step 1: Confirm the existing suite structure**

Run: `ls ~/wrzdj-testing/ && head -30 ~/wrzdj-testing/10-*.sh 2>/dev/null || head -30 ~/wrzdj-testing/01-*.sh`

Read the shape of an existing suite — shebang, API URL variables, curl patterns, PASS/FAIL reporting.

- [ ] **Step 2: Write the suite**

Create `~/wrzdj-testing/11-pre-event-collection.sh` modeled after the existing suites. Include one test block per item:

1. Unauthorized DJ route access (no token → 401, wrong-owner token → 403)
2. Phase gate: event with no collection fields → POST `/collect/{code}/requests` → 409
3. Submission-cap bypass: set cap=3, submit 4 times, fourth → 429
4. Rate-limit: hit `/collect/{code}/requests` 11 times in 60s → 429 on 11th
5. Nickname injection: POST profile with `<script>alert(1)</script>` → 422
6. Email injection: POST profile with `'; DROP TABLE guest_profiles; --@x.y` → 422
7. Bulk-review ownership bypass → 403
8. `collection_phase_override` bad value → 422
9. Request-ids array of 250 → 422

Each block: PASS if expected status, FAIL with details otherwise.

- [ ] **Step 3: Register in `run-all.sh`**

Append `./11-pre-event-collection.sh` (or match the existing registration pattern).

- [ ] **Step 4: Run the suite end-to-end against a local dev instance**

Kick off local services ("push to testing" workflow or the minimum subset). Then:

Run: `~/wrzdj-testing/run-all.sh 11`
Expected: all 9 test blocks PASS. Fix any failures before moving on.

- [ ] **Step 5: No commit in this repo** (the testing suite is outside)

Stop. Move on.

---

## Task 24: Full CI + manual verification

- [ ] **Step 1: Run the full backend CI locally**

Run (from `server/`):
```bash
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/bandit -r app -c pyproject.toml -q
.venv/bin/pytest --tb=short -q
.venv/bin/alembic upgrade head && .venv/bin/alembic check
```
Expected: all green.

- [ ] **Step 2: Run the full frontend CI locally**

Run (from `dashboard/`):
```bash
npm run lint
npx tsc --noEmit
npm test -- --run
```
Expected: all green.

- [ ] **Step 3: Manual verification (push-to-testing workflow)**

Follow the "push to testing" memory entry:
1. Tear down existing services
2. Bring up db + dev-proxy
3. Start backend + frontend with LAN IP env vars
4. Open `https://<LAN_IP>/events/new` in browser → create event with collection enabled
5. Open `https://<LAN_IP>/collect/<code>` on phone → submit + upvote
6. Hit cap → UI + server block
7. Click "Start live now" in DJ tab → `/collect` auto-redirects phone
8. Inspect DB — `email` column has no plaintext

- [ ] **Step 4: Push + PR**

```bash
git push -u origin feat/pre-event-requests
gh pr create --title "feat: Pre-event song collection" --body "$(cat <<'EOF'
## Summary
- Pre-event song voting mode with `/collect/[code]` link
- Live leaderboard, "my picks", gamification (top contributor, first to suggest)
- Optional email opt-in with cross-device identity hooks
- DJ bulk-review tab with accept-top-N / accept-threshold / reject-remaining
- Auto-redirect on phase transition to live

## Test plan
- [ ] Backend CI (ruff, bandit, pytest, alembic check) green
- [ ] Frontend CI (lint, tsc, vitest) green
- [ ] Security suite 11 green (`~/wrzdj-testing/run-all.sh 11`)
- [ ] Manual: create event, submit on phone, hit cap, flip phase, bulk-accept, verify DB encryption
EOF
)"
```

- [ ] **Step 5: Watch CI**

Run: `gh pr checks <pr-number> --watch`
Expected: all checks pass. If any fail, fix locally, commit, push, and re-watch.

---

## Self-Review Results

Ran after plan completion:

**Spec coverage** — every spec section traces to at least one task:
- Data model (events columns, requests column, guest_profiles) → Tasks 1–4
- Derived phase property → Task 2
- Public API (preview, leaderboard, profile, my-picks, submit, vote) → Tasks 7–9
- DJ API (PATCH collection, pending-review, bulk-review) → Tasks 10–12
- Frontend API client → Task 13
- `/collect/[code]` page with FeatureOptIn, MyPicks, LeaderboardTabs, SubmitBar → Tasks 14–19
- `/join/[code]` banner + splash → Task 20
- PreEventVotingTab (three-tab nav) → Task 21
- Event create/edit form collection section → Task 22
- Security suite → Task 23
- CI + manual verification + PR → Task 24

**Placeholder scan** — no TBD/TODO/"add appropriate" patterns. Each code step has concrete code. Exceptions:
- Task 9 tells the engineer to `grep` for the actual vote-service function name (spec-accurate; integration hook depends on existing code the reviewer can see).
- Task 19 tells the engineer to `grep` for the existing search modal before deciding to import-as-is or extract — this is a real decision that depends on the existing code shape, not a placeholder.
- Task 22 tells the engineer to `grep` for the existing event-create/edit form — same reason.

**Type consistency** — cross-checked:
- `CollectLeaderboardRow` fields identical in Python schema (`CollectLeaderboardRow`), TypeScript type, and consumers (LeaderboardTabs, MyPicksPanel).
- `collection_phase_override` allowed values `Literal["force_collection", "force_live"] | None` in Pydantic, `"force_collection" | "force_live" | null` in TS — identical.
- `submitted_during_collection` column name consistent across migration (Task 1), model (Task 3), ORM queries (Tasks 7, 8, 11, 12), and tests.
- Bulk-review action enum identical in Pydantic (`BulkReviewRequest.action`), TS type (`bulkReview`), and backend handler.

No fixes needed.
