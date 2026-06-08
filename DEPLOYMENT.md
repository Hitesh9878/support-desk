# SupportDesk Pro - Deployment Guide

Complete guide for deploying SupportDesk Pro to production environments.

## Table of Contents
1. [Docker Deployment](#docker-deployment)
2. [Cloud Platforms](#cloud-platforms)
3. [Production Checklist](#production-checklist)
4. [Monitoring & Maintenance](#monitoring--maintenance)

---

## Docker Deployment

### Self-Hosted Docker Server

#### 1. Prerequisites
- Linux server (Ubuntu 20.04+ recommended)
- Docker and Docker Compose installed
- Domain name configured
- SSL certificate (Let's Encrypt)

#### 2. Server Setup
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
sudo apt install docker.io -y

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verify installation
docker --version
docker-compose --version
```

#### 3. Deploy Application
```bash
# Clone repository
git clone your-repo-url supportdesk
cd supportdesk

# Create environment file
cp .env.example .env

# Edit with production values
nano .env
```

#### 4. Production Environment Variables
```env
# Core
PORT=5000
NODE_ENV=production

# Database
MONGODB_URI=mongodb://admin:strong_password@mongodb:27017/supportdesk?authSource=admin

# Security
JWT_SECRET=generate_long_random_string_here

# Email (optional)
GMAIL_USER=noreply@yourcompany.com
GMAIL_APP_PASSWORD=your_app_password

# CORS
CORS_ORIGIN=https://yourdomain.com

# Polling
GMAIL_POLLING_INTERVAL=30000
```

#### 5. Generate JWT Secret
```bash
# Generate a strong random secret
openssl rand -base64 32
```

#### 6. Update docker-compose.yml
```yaml
services:
  mongodb:
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: YOUR_STRONG_PASSWORD

  backend:
    environment:
      MONGODB_URI: mongodb://admin:YOUR_STRONG_PASSWORD@mongodb:27017/supportdesk?authSource=admin
      JWT_SECRET: YOUR_GENERATED_SECRET
```

#### 7. Start Application
```bash
# Start in background
docker-compose up -d

# View logs
docker-compose logs -f

# Check services status
docker-compose ps
```

#### 8. Setup Reverse Proxy (Nginx)

Create `/etc/nginx/sites-available/supportdesk`:
```nginx
upstream backend {
    server localhost:5000;
}

server {
    listen 80;
    server_name yourdomain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    # SSL certificates (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # API proxy
    location /api {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket proxy
    location /socket.io {
        proxy_pass http://backend/socket.io;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Static files
    location / {
        root /path/to/supportdesk/public;
        try_files $uri $uri/ /index.html;
    }
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/supportdesk /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### 9. SSL Certificate Setup
```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Generate certificate
sudo certbot certonly --standalone -d yourdomain.com

# Auto-renew (cron job automatically set up)
```

---

## Cloud Platforms

### AWS Deployment

#### Using EC2 + ECS

1. **Create EC2 Instance**
   - Instance type: t3.medium or larger
   - AMI: Ubuntu 22.04 LTS
   - Security group: Open ports 80, 443

2. **Setup Application**
   - SSH into instance
   - Follow Docker deployment steps above

3. **Use RDS for MongoDB** (optional)
   - Create RDS instance with MongoDB
   - Update MONGODB_URI in .env

#### Using ECS Fargate

1. **Create ECR Repository**
   ```bash
   aws ecr create-repository --repository-name supportdesk-backend
   ```

2. **Build and Push Image**
   ```bash
   docker build -t supportdesk-backend server/
   docker tag supportdesk-backend:latest YOUR_ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/supportdesk-backend:latest
   docker push YOUR_ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/supportdesk-backend:latest
   ```

3. **Create ECS Cluster**
   - Service: Select Fargate
   - Task definition: Use pushed image
   - Load balancer: Application Load Balancer

### DigitalOcean App Platform

1. **Connect Repository**
   - Sign in to DigitalOcean
   - Create new App
   - Connect GitHub repository

2. **Configure Services**
   - Backend: Docker service
   - Database: Managed MongoDB
   - Frontend: Static site (public folder)

3. **Environment Variables**
   Add in App Platform dashboard:
   - MONGODB_URI
   - JWT_SECRET
   - GMAIL_USER, GMAIL_APP_PASSWORD
   - CORS_ORIGIN

### Heroku Deployment

1. **Prepare Application**
   ```bash
   # Create Procfile
   echo "web: npm start" > server/Procfile
   ```

2. **Deploy**
   ```bash
   # Install Heroku CLI
   # Login
   heroku login

   # Create app
   heroku create supportdesk-pro

   # Set environment variables
   heroku config:set MONGODB_URI=YOUR_MONGODB_ATLAS_URL
   heroku config:set JWT_SECRET=YOUR_SECRET

   # Deploy
   git push heroku main
   ```

---

## Production Checklist

### Security
- [ ] Change JWT_SECRET to strong random value
- [ ] Set strong MongoDB password
- [ ] Enable SSL/TLS with valid certificate
- [ ] Configure CORS to specific domain
- [ ] Disable debug logging in production
- [ ] Set NODE_ENV=production
- [ ] Enable HTTPS redirect
- [ ] Regular security updates

### Performance
- [ ] Enable MongoDB indexing
- [ ] Configure connection pooling
- [ ] Enable caching (Redis optional)
- [ ] Configure CDN for static assets
- [ ] Set appropriate logging levels
- [ ] Monitor database query performance
- [ ] Configure rate limiting

### Reliability
- [ ] Setup automated backups
- [ ] Configure health checks
- [ ] Enable auto-restart for containers
- [ ] Setup monitoring and alerts
- [ ] Configure log aggregation
- [ ] Create disaster recovery plan
- [ ] Test backup restoration

### Compliance
- [ ] Review data privacy policies
- [ ] Enable GDPR compliance features
- [ ] Setup audit logging
- [ ] Configure access controls
- [ ] Document data retention policies

---

## Monitoring & Maintenance

### Application Monitoring

#### Using PM2 (Local)
```bash
npm install -g pm2

pm2 start server.js --name "supportdesk-backend"
pm2 save
pm2 startup
```

#### Using Docker Health Checks
Already configured in docker-compose.yml

#### Custom Monitoring Script
```bash
#!/bin/bash
# check-health.sh

BACKEND_URL="https://yourdomain.com/api/health"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" $BACKEND_URL)

if [ $RESPONSE -eq 200 ]; then
    echo "Backend is healthy"
else
    echo "Backend error - Status: $RESPONSE"
    # Trigger alert
fi
```

### Logging

#### View Logs
```bash
# Docker logs
docker-compose logs -f backend

# MongoDB logs
docker-compose logs -f mongodb

# Real-time monitoring
docker stats
```

#### Log Rotation
```bash
# In docker-compose.yml
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

### Database Maintenance

#### Backup MongoDB
```bash
# Manual backup
docker exec supportdesk-mongodb mongodump --out /backup

# Automated daily backup
# Add to crontab
0 2 * * * docker exec supportdesk-mongodb mongodump --out /backup/$(date +\%Y-\%m-\%d)
```

#### Restore MongoDB
```bash
docker exec supportdesk-mongodb mongorestore /backup
```

#### Database Optimization
```bash
# Connect to MongoDB
docker exec -it supportdesk-mongodb mongosh

# Create indexes
db.tickets.createIndex({ "status": 1, "createdAt": -1 })
db.customers.createIndex({ "email": 1 })
db.messages.createIndex({ "ticket": 1, "createdAt": -1 })
```

### Updates & Patches

#### Update Application
```bash
# Pull latest code
git pull origin main

# Rebuild containers
docker-compose build

# Restart services
docker-compose up -d

# Verify health
curl https://yourdomain.com/api/health
```

#### Update Dependencies
```bash
# Check for updates
npm audit

# Update packages
npm update

# Rebuild Docker image
docker-compose build --no-cache backend
```

---

## Troubleshooting

### Container Won't Start
```bash
# Check logs
docker-compose logs backend

# Restart
docker-compose restart backend

# Rebuild
docker-compose build --no-cache && docker-compose up -d
```

### Database Connection Issues
```bash
# Check MongoDB status
docker-compose logs mongodb

# Test connection
docker-compose exec backend npm test

# Verify credentials in .env
```

### High Memory Usage
```bash
# Check container stats
docker stats

# Restart container
docker-compose restart backend

# Check for memory leaks in logs
```

### SSL Certificate Issues
```bash
# Check certificate
sudo openssl x509 -in /etc/letsencrypt/live/yourdomain.com/cert.pem -text -noout

# Renew certificate
sudo certbot renew

# Test renewal
sudo certbot renew --dry-run
```

---

## Performance Optimization

### Database
```bash
# Add compound indexes
db.tickets.createIndex({ status: 1, priority: 1, createdAt: -1 })

# Enable compression
compression: true
```

### API
```javascript
// In server.js
const compression = require('compression');
app.use(compression());
```

### Frontend
- Minimize CSS and JavaScript
- Use CDN for static assets
- Enable browser caching
- Optimize images

---

## Cost Optimization

1. **Database**: Use managed services (MongoDB Atlas)
2. **Storage**: Use object storage (S3) for files
3. **Compute**: Right-size instances
4. **Transfer**: Cache content locally
5. **Monitoring**: Use free tier tools

---

## Support & Resources

- [Docker Documentation](https://docs.docker.com/)
- [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [Let's Encrypt](https://letsencrypt.org/)

---

**Happy deploying! 🚀**
