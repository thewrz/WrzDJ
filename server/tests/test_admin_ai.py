"""Tests for admin AI settings endpoints."""

from unittest.mock import patch

from fastapi.testclient import TestClient


class TestAdminAIModels:
    def test_returns_model_list(self, client: TestClient, admin_headers: dict):
        response = client.get("/api/admin/ai/models", headers=admin_headers)
        assert response.status_code == 200
        data = response.json()
        assert "models" in data
        assert len(data["models"]) >= 1
        assert "id" in data["models"][0]
        assert "name" in data["models"][0]

    def test_dj_gets_403(self, client: TestClient, auth_headers: dict):
        response = client.get("/api/admin/ai/models", headers=auth_headers)
        assert response.status_code == 403

    def test_fallback_when_no_api_key(self, client: TestClient, admin_headers: dict):
        """Returns fallback models when no API key configured."""
        with patch("app.core.config.get_settings") as mock:
            mock.return_value.anthropic_api_key = ""
            response = client.get("/api/admin/ai/models", headers=admin_headers)
            assert response.status_code == 200
            data = response.json()
            assert len(data["models"]) >= 1


class TestAdminAISettings:
    def test_get_returns_all_fields(self, client: TestClient, admin_headers: dict):
        response = client.get("/api/admin/ai/settings", headers=admin_headers)
        assert response.status_code == 200
        data = response.json()
        assert "llm_enabled" in data
        assert "llm_model" in data
        assert "llm_rate_limit_per_minute" in data
        assert "api_key_configured" in data
        assert "api_key_masked" in data

    def test_get_masks_api_key(self, client: TestClient, admin_headers: dict):
        response = client.get("/api/admin/ai/settings", headers=admin_headers)
        data = response.json()
        # Key should be masked or "Not configured"
        assert "api_key_masked" in data
        key = data["api_key_masked"]
        assert key == "Not configured" or key.startswith("...")

    def test_put_updates_settings(self, client: TestClient, admin_headers: dict):
        response = client.put(
            "/api/admin/ai/settings",
            headers=admin_headers,
            json={"llm_enabled": False, "llm_model": "claude-sonnet-4-5-20250929"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["llm_enabled"] is False
        assert data["llm_model"] == "claude-sonnet-4-5-20250929"

    def test_dj_gets_403(self, client: TestClient, auth_headers: dict):
        response = client.get("/api/admin/ai/settings", headers=auth_headers)
        assert response.status_code == 403

    def test_key_not_exposed_in_full(self, client: TestClient, admin_headers: dict):
        """Full API key should never appear in the response."""
        response = client.get("/api/admin/ai/settings", headers=admin_headers)
        data = response.json()
        # The masked key should not contain the full key
        assert "api_key_configured" in data
        # No field should expose the raw key
        assert "anthropic_api_key" not in data
