# UoG Website - Full Stack Demo

A modern, elegant website built with Django, React, PostgreSQL, and Docker Compose.

## Project Structure

```
uog-website/
├── backend/              # Django REST API
│   ├── api/             # API app with models and views
│   ├── config/          # Django settings and configuration
│   ├── manage.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/            # React SPA
│   ├── public/
│   ├── src/            # React components and styles
│   ├── package.json
│   └── Dockerfile
├── nginx/              # Reverse proxy configuration
├── docker-compose.yml
└── .env               # Environment variable

## Prerequisites

- Docker & Docker Compose
- Git

## Getting Started

### 1. Clone/Setup the Project

```bash
cd uog-website
```

### 2. Environment Setup

The `.env` file is already configured with default values. Modify if needed:

```bash
# Edit .env for production settings
cp .env.example .env
```

### 3. Start Services

```bash
docker-compose up --build
```

This will:
- Build and start PostgreSQL database
- Build and start Django backend (http://localhost:8000)
- Build and start React frontend (http://localhost:3000)
- Configure Nginx reverse proxy (http://localhost:80)

### 4. Initialize Database

Migrations run automatically on backend startup. To create a superuser:

```bash
docker-compose exec backend python manage.py createsuperuser
```

## Access Points

- **Frontend:** http://localhost:3000 or http://localhost
- **Backend API:** http://localhost:8000/api/
- **Django Admin:** http://localhost:8000/admin/
- **Database:** localhost:5432

## Development

### Frontend Development

```bash
docker-compose exec frontend npm start
```

### Backend Development

```bash
docker-compose exec backend python manage.py runserver 0.0.0.0:8000
```

### Database Shell

```bash
docker-compose exec db psql -U uog_user -d uog_db
```