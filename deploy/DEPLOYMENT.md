# WrzDJ VPS Deployment Guide

This guide covers deploying WrzDJ on a VPS using Docker Compose with the subdomain model:
- **Frontend**: `https://app.yourdomain.com`
- **Backend**: `https://api.yourdomain.com`

## Prerequisites

- Ubuntu 22.04+ VPS with:
  - **Minimum 1GB RAM** (2GB+ recommended)
  - Docker and Docker Compose
  - nginx (will be installed in step 3)
  - Certbot (will be installed in step 3)
- DNS A records pointing to your server:
  - `app.yourdomain.com` → `<your-server-ip>`
  - `api.yourdomain.com` → `<your-server-ip>`

### Memory Requirements

If your VPS has only 1GB RAM, add swap space to prevent OOM during builds:

```bash
# Create 2GB swap file
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Verify
free -h
```

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

### 3. Install and configure nginx

```bash
# Install nginx and certbot
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx

# Generate and install nginx configs from templates
# Replace yourdomain.com with your actual domain
APP_DOMAIN=app.yourdomain.com API_DOMAIN=api.yourdomain.com ./deploy/setup-nginx.sh

# The setup script will:
# - Generate configs from deploy/nginx/*.conf.template
# - Install them to /etc/nginx/sites-available/
# - Symlink to sites-enabled/
# - Test and reload nginx
#
# Optional: customize ports (default 8000/3000)
# APP_DOMAIN=app.yourdomain.com API_DOMAIN=api.yourdomain.com \
#   PORT_API=9000 PORT_FRONTEND=4000 ./deploy/setup-nginx.sh

# Remove default site (optional)
sudo rm -f /etc/nginx/sites-enabled/default

# Hide nginx version (security hardening)
sudo sed -i 's/# server_tokens off;/server_tokens off;/' /etc/nginx/nginx.conf

# Start nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 4. Set up SSL certificates with Let's Encrypt

**Important:** DNS must be pointing to your server before running certbot.

```bash
# Get certificates (certbot will update nginx configs automatically)
sudo certbot --nginx -d api.yourdomain.com
sudo certbot --nginx -d app.yourdomain.com

# Verify auto-renewal is enabled
sudo systemctl status certbot.timer

# Test renewal (dry run)
sudo certbot renew --dry-run
```

Certificates auto-renew via systemd timer. Manual renewal if needed:
```bash
sudo certbot renew
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

- Frontend: https://app.yourdomain.com
- API health: https://api.yourdomain.com/health
- API docs: https://api.yourdomain.com/docs
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
CORS_ORIGINS=https://app.yourdomain.com
```

### 502 Bad Gateway

Check if containers are running:
```bash
docker compose -f deploy/docker-compose.yml ps
```

Ensure nginx is proxying to correct ports (defaults: api on 8000, web on 3000).
If you changed `PORT_API` or `PORT_FRONTEND`, re-run `setup-nginx.sh` with the same values.

## Security Checklist

### Application Security
- [ ] Strong `JWT_SECRET` (use `openssl rand -hex 32`)
- [ ] Strong `POSTGRES_PASSWORD`
- [ ] `CORS_ORIGINS` set to specific domain (not `*`)
- [ ] Database not exposed externally (127.0.0.1 only)
- [ ] Rate limiting enabled (auto-enabled in production)
- [ ] Login lockout enabled (auto-enabled in production)

### Server Security
- [ ] HTTPS enabled (certbot)
- [ ] Firewall configured (only 80, 443, 22 open)
- [ ] nginx version hidden (`server_tokens off`)
- [ ] SSH key authentication (disable password auth)

### Security Headers (verify in browser dev tools)
- [ ] `Strict-Transport-Security` (HSTS)
- [ ] `X-Content-Type-Options: nosniff`
- [ ] `X-Frame-Options: DENY` or `SAMEORIGIN`
- [ ] `X-XSS-Protection: 1; mode=block`
- [ ] `Referrer-Policy: strict-origin-when-cross-origin`
- [ ] `Content-Security-Policy` (CSP)

Verify headers:
```bash
curl -I https://api.yourdomain.com/health | grep -iE 'strict|x-frame|x-content|x-xss|referrer|security'
```

See `docs/security/manual-checklist.md` for the complete security checklist.
