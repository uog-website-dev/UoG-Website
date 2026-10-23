# UoG Digital Platform — backend image (Python 3.12 / Django 5.1)
FROM python:3.12.15-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# System dependencies: postgresql-client (migration wait/readiness), curl (healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
        postgresql-client \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Install pinned Python dependencies first for layer caching.
# CI/production can pass --build-arg REQUIREMENTS_FILE=requirements/prod.txt
COPY requirements/ requirements/
ARG REQUIREMENTS_FILE=requirements/dev.txt
RUN pip install -r "${REQUIREMENTS_FILE}"

# Application source
COPY . .
RUN chmod +x entrypoint.sh
RUN DEBUG=False python manage.py collectstatic --noinput

EXPOSE 8000

# entrypoint.sh applies migrations with the migration role, then execs the
# container command (dev: runserver via docker-compose; prod: gunicorn below).
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--access-logfile", "-", "--error-logfile", "-"]
