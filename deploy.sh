#!/bin/bash
# UoG Website Deployment Script
# Usage: ./deploy.sh [tag]

set -e

echo "========================================="
echo "UoG Website Deployment"
echo "========================================="

# Check if .env.prod exists
if [ ! -f .env.prod ]; then
    echo "❌ .env.prod file not found!"
    echo "Please copy .env.prod.example to .env.prod and update values"
    exit 1
fi

# Load environment variables
source .env.prod

# Set tag (default to latest if not specified)
TAG=${1:-latest}
export TAG

echo "📦 Deploying with tag: $TAG"

# Login to Docker Hub (if needed)
echo "🔐 Logging into Docker Hub..."
docker login -u uogwebsite

# Pull latest images
echo "📥 Pulling latest images..."
docker-compose -f docker-compose.prod.yml pull

# Stop and remove old containers
echo "🛑 Stopping old containers..."
docker-compose -f docker-compose.prod.yml down

# Start new containers
echo "🚀 Starting new containers..."
docker-compose -f docker-compose.prod.yml up -d

# Run database migrations
echo "🗄️ Running database migrations..."
docker-compose -f docker-compose.prod.yml exec backend python manage.py migrate --noinput

# Collect static files
echo "📁 Collecting static files..."
docker-compose -f docker-compose.prod.yml exec backend python manage.py collectstatic --noinput

# Check container status
echo "✅ Deployment complete!"
echo ""
echo "Container status:"
docker-compose -f docker-compose.prod.yml ps

echo ""
echo "🌐 Website should be available at: http://YOUR_VM_IP"
echo "========================================="
