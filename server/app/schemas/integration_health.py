from enum import Enum

from pydantic import BaseModel


class CapabilityStatus(str, Enum):
    """Status of a specific capability for a service."""

    YES = "yes"
    NO = "no"
    NOT_IMPLEMENTED = "not_implemented"
    CONFIGURED = "configured"
    NOT_CONFIGURED = "not_configured"


class ServiceCapabilities(BaseModel):
    """Capability matrix for a single integration service."""

    auth: CapabilityStatus
    catalog_search: CapabilityStatus
    playlist_sync: CapabilityStatus


class IntegrationServiceStatus(BaseModel):
    """Full status for a single integration service."""

    service: str
    display_name: str
    enabled: bool
    configured: bool
    capabilities: ServiceCapabilities
    last_check_error: str | None = None


class IntegrationHealthResponse(BaseModel):
    """Response for GET /api/admin/integrations."""

    services: list[IntegrationServiceStatus]


class IntegrationToggleRequest(BaseModel):
    """Request body for PATCH /api/admin/integrations/{service}."""

    enabled: bool


class IntegrationToggleResponse(BaseModel):
    """Response for PATCH /api/admin/integrations/{service}."""

    service: str
    enabled: bool


class IntegrationCheckResponse(BaseModel):
    """Response for POST /api/admin/integrations/{service}/check."""

    service: str
    healthy: bool
    capabilities: ServiceCapabilities
    error: str | None = None
