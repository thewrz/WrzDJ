"""Pydantic schemas for voting."""

from pydantic import BaseModel


class VoteResponse(BaseModel):
    status: str
    vote_count: int
    has_voted: bool
