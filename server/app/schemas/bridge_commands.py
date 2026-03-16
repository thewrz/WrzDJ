"""Schemas for bridge admin command endpoints."""

from typing import Literal

from pydantic import BaseModel, Field


class BridgeCommandRequest(BaseModel):
    """Request body for queuing a bridge command."""

    command_type: Literal["reset_decks", "reconnect", "restart"] = Field(
        ..., description="The type of command to send to the bridge"
    )


class BridgeCommandResponse(BaseModel):
    """Response after queuing a bridge command."""

    command_id: str = Field(..., description="UUID of the queued command")
    command_type: str = Field(..., description="The command type that was queued")


class BridgeCommandsPollResponse(BaseModel):
    """Response for bridge polling pending commands."""

    commands: list[BridgeCommandResponse] = Field(
        default_factory=list, description="List of pending commands"
    )
