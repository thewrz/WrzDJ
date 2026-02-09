"""Tests for CORS configuration.

Regression: PUT was missing from allow_methods for non-wildcard CORS origins,
causing preflight failures on the Tidal settings endpoint in production.
"""

from fastapi.middleware.cors import CORSMiddleware

from app.main import CORS_ALLOW_METHODS, app


class TestCorsConfiguration:
    """Verify CORS allows all HTTP methods used by the API."""

    def test_cors_methods_cover_all_api_routes(self):
        """Every HTTP method used by an API route must be in CORS_ALLOW_METHODS."""
        api_methods = set()
        for route in app.routes:
            if hasattr(route, "methods") and route.methods:
                api_methods.update(route.methods)

        for method in api_methods:
            if method == "HEAD":
                continue  # HEAD is implicitly handled
            assert method in CORS_ALLOW_METHODS, (
                f"HTTP {method} is used by API routes but missing from CORS_ALLOW_METHODS"
            )

    def test_cors_methods_include_put(self):
        """PUT must be allowed — required by Tidal settings endpoint."""
        assert "PUT" in CORS_ALLOW_METHODS

    def test_cors_middleware_is_configured(self):
        """CORSMiddleware must be present in the middleware stack."""
        cors_mw = next(
            (m for m in app.user_middleware if m.cls is CORSMiddleware),
            None,
        )
        assert cors_mw is not None, "CORSMiddleware not found on app"
