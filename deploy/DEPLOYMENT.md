# WrzDJ VPS Deployment Guide

This guide covers deploying WrzDJ on a VPS using Docker Compose with the subdomain model:
- **Frontend**: `https://app.wrzdj.com`
- **Backend**: `https://api.wrzdj.com`

## Prerequisites

- Ubuntu 22.04+ VPS with:
  - Docker and Docker Compose
  - nginx installed and running
  - Certbot for SSL certificates
- DNS A records pointing to your server:
  - `app.wrzdj.com` → `<your-server-ip>`
  - `api.wrzdj.com` → `<your-server-ip>`

## Deployment Steps

### 1. Clone the repository

```bash
cd /opt
git clone https://github.com/yourusername/WrzDJ.git
cd WrzDJ
```

### 2. Configure environment

```bash
cp deploy/.env.example deploy/.env
nano deploy/.env
```

Generate a secure JWT secret:
```bash
openssl rand -hex 32
```

Fill in all required values in `deploy/.env`:
- `POSTGRES_PASSWORD` - secure database password
- `JWT_SECRET` - generated secret above
- `SPOTIFY_CLIENT_ID` - from Spotify Developer Dashboard
- `SPOTIFY_CLIENT_SECRET` - from Spotify Developer Dashboard

### 3. Set up SSL certificates

```bash
# Frontend
sudo certbot certonly --nginx -d app.wrzdj.com

# Backend
sudo certbot certonly --nginx -d api.wrzdj.com
```

### 4. Configure nginx

```bash
# Copy configs
sudo cp deploy/nginx/app.wrzdj.com.conf /etc/nginx/sites-available/
sudo cp deploy/nginx/api.wrzdj.com.conf /etc/nginx/sites-available/

# Enable sites
sudo ln -s /etc/nginx/sites-available/app.wrzdj.com.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/api.wrzdj.com.conf /etc/nginx/sites-enabled/

# Test and reload
sudo nginx -t
sudo systemctl reload nginx
```

### 5. Build and start services

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

### 6. Create admin user

```bash
docker compose -f deploy/docker-compose.yml exec api \
  python -m app.scripts.create_user --username admin --password your-secure-password
```

### 7. Verify deployment

- Frontend: https://app.wrzdj.com
- API health: https://api.wrzdj.com/health
- API docs: https://api.wrzdj.com/docs
- Login with admin credentials

## Maintenance

### View logs

```bash
# All services
docker compose -f deploy/docker-compose.yml logs -f

# Specific service
docker compose -f deploy/docker-compose.yml logs -f api
docker compose -f deploy/docker-compose.yml logs -f web
docker compose -f deploy/docker-compose.yml logs -f db
```

### Restart services

```bash
docker compose -f deploy/docker-compose.yml restart
```

### Update deployment

```bash
git pull
docker compose -f deploy/docker-compose.yml up -d --build
```

### Database backup

```bash
# Create backup
docker compose -f deploy/docker-compose.yml exec db \
  pg_dump -U wrzdj wrzdj > backup-$(date +%Y%m%d).sql

# Restore backup
cat backup.sql | docker compose -f deploy/docker-compose.yml exec -T db \
  psql -U wrzdj wrzdj
```

### SSL certificate renewal

Certbot auto-renews certificates. To manually renew:
```bash
sudo certbot renew
sudo systemctl reload nginx
```

## Troubleshooting

### Container won't start

Check logs:
```bash
docker compose -f deploy/docker-compose.yml logs api
```

Common issues:
- Database not ready: container restarts until DB is healthy
- Missing env vars: check `deploy/.env` has all required values

### CORS errors

Verify `CORS_ORIGINS` in `deploy/.env` matches your frontend domain exactly:
```
CORS_ORIGINS=https://app.wrzdj.com
```

### 502 Bad Gateway

Check if containers are running:
```bash
docker compose -f deploy/docker-compose.yml ps
```

Ensure nginx is proxying to correct ports (api: 8000, web: 3000).

## Security Checklist

- [ ] Strong `JWT_SECRET` (use `openssl rand -hex 32`)
- [ ] Strong `POSTGRES_PASSWORD`
- [ ] HTTPS enabled (certbot)
- [ ] `CORS_ORIGINS` set to specific domain (not `*`)
- [ ] Firewall configured (only 80, 443, 22 open)
- [ ] Database not exposed externally (127.0.0.1 only)
- [ ] Rate limiting enabled (auto-enabled in production)
- [ ] Login lockout enabled (auto-enabled in production)
- [ ] Security headers verified (check browser dev tools)

See `docs/security/manual-checklist.md` for the complete security checklist.
