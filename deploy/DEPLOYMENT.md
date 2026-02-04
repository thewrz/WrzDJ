# WrzDJ Deployment Guide

## Prerequisites

- Ubuntu VPS with Docker and Docker Compose
- nginx installed and running
- Certbot for SSL certificates
- Domain pointing to your server (e.g., wrzdj.wrzonance.com)

## Deployment Steps

### 1. Clone the repository

```bash
cd /opt
git clone https://github.com/yourusername/WrzDJ.git
cd WrzDJ
```

### 2. Configure environment

```bash
cp deploy/.env.example .env
# Edit .env with secure values
nano .env
```

Generate a secure JWT secret:
```bash
openssl rand -hex 32
```

### 3. Set up SSL certificate

```bash
sudo certbot certonly --nginx -d wrzdj.wrzonance.com
```

### 4. Configure nginx

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/wrzdj.wrzonance.com
sudo ln -s /etc/nginx/sites-available/wrzdj.wrzonance.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 5. Build and start services

```bash
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

### 6. Create admin user

```bash
docker compose -f deploy/docker-compose.prod.yml exec api python -m app.scripts.create_user --username admin --password your-secure-password
```

### 7. Verify deployment

- Visit https://wrzdj.wrzonance.com
- Check API health: https://wrzdj.wrzonance.com/health
- Login with admin credentials

## Maintenance

### View logs

```bash
docker compose -f deploy/docker-compose.prod.yml logs -f
```

### Restart services

```bash
docker compose -f deploy/docker-compose.prod.yml restart
```

### Update deployment

```bash
git pull
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

### Database backup

```bash
docker compose -f deploy/docker-compose.prod.yml exec db pg_dump -U wrzdj wrzdj > backup.sql
```
