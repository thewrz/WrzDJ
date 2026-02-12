"""Pytest configuration and fixtures for WrzDJ tests."""

from collections.abc import Generator
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core.time import utcnow
from app.main import app
from app.models.base import Base
from app.models.event import Event
from app.models.request import Request, RequestStatus
from app.models.user import User
from app.services.auth import get_password_hash

# Use SQLite in-memory for tests (fast, isolated)
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="function")
def db() -> Generator[Session, None, None]:
    """Create a fresh database for each test."""
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function")
def client(db: Session) -> Generator[TestClient, None, None]:
    """Create a test client with database override."""

    def override_get_db():
        try:
            yield db
        finally:
            pass  # Don't close the session here, let the db fixture handle it

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def test_user(db: Session) -> User:
    """Create a test user with DJ role."""
    user = User(
        username="testuser",
        password_hash=get_password_hash("testpassword123"),
        role="dj",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def admin_user(db: Session) -> User:
    """Create an admin test user."""
    user = User(
        username="adminuser",
        password_hash=get_password_hash("adminpassword123"),
        role="admin",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def admin_headers(client: TestClient, admin_user: User) -> dict[str, str]:
    """Get authentication headers for the admin user."""
    response = client.post(
        "/api/auth/login",
        data={"username": "adminuser", "password": "adminpassword123"},
    )
    assert response.status_code == 200, f"Login failed: {response.json()}"
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def pending_user(db: Session) -> User:
    """Create a pending test user."""
    user = User(
        username="pendinguser",
        password_hash=get_password_hash("pendingpassword123"),
        role="pending",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def pending_headers(client: TestClient, pending_user: User) -> dict[str, str]:
    """Get authentication headers for the pending user."""
    response = client.post(
        "/api/auth/login",
        data={"username": "pendinguser", "password": "pendingpassword123"},
    )
    assert response.status_code == 200, f"Login failed: {response.json()}"
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth_headers(client: TestClient, test_user: User) -> dict[str, str]:
    """Get authentication headers for the test user."""
    response = client.post(
        "/api/auth/login",
        data={"username": "testuser", "password": "testpassword123"},
    )
    assert response.status_code == 200, f"Login failed: {response.json()}"
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def test_event(db: Session, test_user: User) -> Event:
    """Create a test event."""
    event = Event(
        code="TEST01",
        name="Test Event",
        created_by_user_id=test_user.id,
        expires_at=utcnow() + timedelta(hours=6),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@pytest.fixture
def test_request(db: Session, test_event: Event) -> Request:
    """Create a test song request."""
    request = Request(
        event_id=test_event.id,
        song_title="Test Song",
        artist="Test Artist",
        source="manual",
        status=RequestStatus.NEW.value,
        dedupe_key="test_dedupe_key_12345678",
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    return request
