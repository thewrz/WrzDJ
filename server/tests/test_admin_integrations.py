"""Tests for admin integration API endpoints."""

from fastapi.testclient import TestClient


class TestAdminGetIntegrations:
    def test_admin_gets_integrations(self, client: TestClient, admin_headers: dict):
        response = client.get("/api/admin/integrations", headers=admin_headers)
        assert response.status_code == 200
        data = response.json()
        assert "services" in data
        assert len(data["services"]) == 4
        service_names = [s["service"] for s in data["services"]]
        assert "spotify" in service_names
        assert "tidal" in service_names
        assert "beatport" in service_names
        assert "bridge" in service_names

    def test_each_service_has_required_fields(self, client: TestClient, admin_headers: dict):
        response = client.get("/api/admin/integrations", headers=admin_headers)
        data = response.json()
        for svc in data["services"]:
            assert "capabilities" in svc
            assert "auth" in svc["capabilities"]
            assert "catalog_search" in svc["capabilities"]
            assert "playlist_sync" in svc["capabilities"]
            assert "enabled" in svc
            assert "display_name" in svc
            assert "configured" in svc
            assert "service" in svc

    def test_dj_cannot_access(self, client: TestClient, auth_headers: dict):
        response = client.get("/api/admin/integrations", headers=auth_headers)
        assert response.status_code == 403

    def test_unauthenticated_cannot_access(self, client: TestClient):
        response = client.get("/api/admin/integrations")
        assert response.status_code == 401

    def test_no_tokens_in_response(self, client: TestClient, admin_headers: dict):
        """SECURITY: Verify no token/credential data leaked."""
        response = client.get("/api/admin/integrations", headers=admin_headers)
        body = response.text.lower()
        assert "secret" not in body
        assert "access_token" not in body
        assert "refresh_token" not in body
        assert "password" not in body


class TestAdminToggleIntegration:
    def test_disable_spotify(self, client: TestClient, admin_headers: dict):
        response = client.patch(
            "/api/admin/integrations/spotify",
            headers=admin_headers,
            json={"enabled": False},
        )
        assert response.status_code == 200
        assert response.json()["service"] == "spotify"
        assert response.json()["enabled"] is False

    def test_enable_spotify(self, client: TestClient, admin_headers: dict):
        # First disable
        client.patch(
            "/api/admin/integrations/spotify",
            headers=admin_headers,
            json={"enabled": False},
        )
        # Then re-enable
        response = client.patch(
            "/api/admin/integrations/spotify",
            headers=admin_headers,
            json={"enabled": True},
        )
        assert response.status_code == 200
        assert response.json()["enabled"] is True

    def test_invalid_service_returns_400(self, client: TestClient, admin_headers: dict):
        response = client.patch(
            "/api/admin/integrations/nonexistent",
            headers=admin_headers,
            json={"enabled": False},
        )
        assert response.status_code == 400

    def test_dj_cannot_toggle(self, client: TestClient, auth_headers: dict):
        response = client.patch(
            "/api/admin/integrations/spotify",
            headers=auth_headers,
            json={"enabled": False},
        )
        assert response.status_code == 403

    def test_toggle_persists_in_settings(self, client: TestClient, admin_headers: dict):
        client.patch(
            "/api/admin/integrations/tidal",
            headers=admin_headers,
            json={"enabled": False},
        )
        # Verify via settings endpoint
        response = client.get("/api/admin/settings", headers=admin_headers)
        assert response.json()["tidal_enabled"] is False

    def test_toggle_reflected_in_integrations_list(self, client: TestClient, admin_headers: dict):
        client.patch(
            "/api/admin/integrations/beatport",
            headers=admin_headers,
            json={"enabled": False},
        )
        response = client.get("/api/admin/integrations", headers=admin_headers)
        beatport = next(s for s in response.json()["services"] if s["service"] == "beatport")
        assert beatport["enabled"] is False

    def test_toggle_all_services(self, client: TestClient, admin_headers: dict):
        for service in ("spotify", "tidal", "beatport", "bridge"):
            response = client.patch(
                f"/api/admin/integrations/{service}",
                headers=admin_headers,
                json={"enabled": False},
            )
            assert response.status_code == 200
            assert response.json()["service"] == service
            assert response.json()["enabled"] is False


class TestAdminCheckIntegrationHealth:
    def test_check_bridge_health(self, client: TestClient, admin_headers: dict):
        response = client.post(
            "/api/admin/integrations/bridge/check",
            headers=admin_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert "healthy" in data
        assert "capabilities" in data
        assert data["service"] == "bridge"

    def test_check_returns_capabilities(self, client: TestClient, admin_headers: dict):
        response = client.post(
            "/api/admin/integrations/tidal/check",
            headers=admin_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert "auth" in data["capabilities"]
        assert "catalog_search" in data["capabilities"]
        assert "playlist_sync" in data["capabilities"]

    def test_invalid_service_returns_400(self, client: TestClient, admin_headers: dict):
        response = client.post(
            "/api/admin/integrations/nonexistent/check",
            headers=admin_headers,
        )
        assert response.status_code == 400

    def test_dj_cannot_check(self, client: TestClient, auth_headers: dict):
        response = client.post(
            "/api/admin/integrations/spotify/check",
            headers=auth_headers,
        )
        assert response.status_code == 403

    def test_unauthenticated_cannot_check(self, client: TestClient):
        response = client.post("/api/admin/integrations/spotify/check")
        assert response.status_code == 401
