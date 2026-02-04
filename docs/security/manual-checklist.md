# WrzDJ Security Checklist

Manual security review checklist for production deployments.

## Authentication & Authorization

- [ ] JWT_SECRET is set to a cryptographically secure random value (32+ chars)
- [ ] JWT_SECRET is different between staging and production
- [ ] Default passwords have been changed
- [ ] Session expiry is configured appropriately (default: 7 days)
- [ ] Rate limiting is enabled on login endpoint (5/min)
- [ ] Login lockout is enabled (5 failures = 5min, 10 failures = 30min)
- [ ] All protected endpoints require valid JWT token
- [ ] Event ownership is validated before allowing modifications

## Input Validation

- [ ] Search queries are limited (2-200 chars)
- [ ] Song request fields are sanitized
- [ ] Event codes are validated format
- [ ] All user input is escaped before database queries (SQLAlchemy handles this)
- [ ] File uploads are restricted (if applicable)

## Abuse Prevention

- [ ] Rate limiting is enabled for:
  - [ ] Login: 5/minute per IP
  - [ ] Search: 30/minute per IP
  - [ ] Song requests: 10/minute per IP
- [ ] Duplicate song detection is active
- [ ] Event expiry is enforced
- [ ] Cache TTL is configured appropriately

## Security Headers

### FastAPI (API Server)
- [ ] X-Content-Type-Options: nosniff
- [ ] X-Frame-Options: SAMEORIGIN
- [ ] Referrer-Policy: strict-origin-when-cross-origin
- [ ] X-XSS-Protection: 1; mode=block
- [ ] Cache-Control: no-store (for API responses)

### Nginx
- [ ] Content-Security-Policy is configured
- [ ] Strict-Transport-Security (HSTS) is enabled
- [ ] SSL/TLS certificates are valid and not expired
- [ ] HTTP to HTTPS redirect is in place

## Proxy & Network Configuration

- [ ] CORS_ORIGINS is set to specific domains (not "*" in production)
- [ ] X-Forwarded-For header is trusted from nginx only
- [ ] X-Real-IP header is set by nginx
- [ ] Internal services are not exposed to public internet
- [ ] Database is not accessible from public internet
- [ ] Firewall rules restrict unnecessary ports

## Secrets & Configuration

- [ ] .env file is not in version control
- [ ] SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are set
- [ ] Database credentials are secure
- [ ] No secrets are logged or exposed in error messages
- [ ] Environment is set to "production"

## Monitoring & Logging

- [ ] Error logging is enabled
- [ ] Access logs are being collected
- [ ] Failed login attempts are logged
- [ ] Alerts are configured for unusual activity
- [ ] Log files are rotated and secured

## Dependencies

- [ ] pip-audit shows no critical vulnerabilities
- [ ] npm audit shows no critical vulnerabilities
- [ ] Bandit scan passes with no high-severity issues
- [ ] All dependencies are up to date (or have no known vulns)

## Deployment

- [ ] Production build is used (not dev server)
- [ ] Debug mode is disabled
- [ ] Stack traces are not exposed to users
- [ ] Health check endpoints are accessible
- [ ] Backup strategy is in place for database

## Review Schedule

- [ ] Weekly: Check for dependency updates
- [ ] Monthly: Review access logs for anomalies
- [ ] Quarterly: Full security checklist review
- [ ] After incidents: Post-mortem and checklist update
