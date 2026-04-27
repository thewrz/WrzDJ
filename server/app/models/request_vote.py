from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utcnow
from app.models.base import Base


class RequestVote(Base):
    __tablename__ = "request_votes"
    __table_args__ = (
        UniqueConstraint("request_id", "client_fingerprint", name="uq_request_vote"),
        UniqueConstraint("request_id", "guest_id", name="uq_request_vote_guest"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int] = mapped_column(
        ForeignKey("requests.id", ondelete="CASCADE"), index=True
    )
    client_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    guest_id: Mapped[int | None] = mapped_column(
        ForeignKey("guests.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    request: Mapped["Request"] = relationship("Request", back_populates="votes")
