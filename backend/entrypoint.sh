#!/bin/bash
set -e

echo "=== Waiting for PostgreSQL ==="
while ! pg_isready -h "$DB_HOST" -U "$DB_USER"; do
  echo "PostgreSQL is unavailable - sleeping"
  sleep 1
done
echo "✓ PostgreSQL is up"

echo "=== Running makemigrations ==="
python manage.py makemigrations --noinput || echo "makemigrations returned $?"

echo "=== Running migrate ==="
python manage.py migrate --noinput || {
  echo "ERROR: migrate failed with exit code $?"
  exit 1
}
echo "✓ Database migrations complete"

echo "=== Collecting static files ==="
python manage.py collectstatic --noinput --clear || echo "collectstatic warning (non-critical)"

echo "=== Starting Django development server ==="
python manage.py runserver 0.0.0.0:8000
