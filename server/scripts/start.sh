#!/bin/bash
set -e

# Wait for database to be ready
echo "Waiting for database..."
MAX_RETRIES=30
RETRY_INTERVAL=2

for i in $(seq 1 $MAX_RETRIES); do
    if python -c "
from app.db.session import engine
from sqlalchemy import text
with engine.connect() as conn:
    conn.execute(text('SELECT 1'))
" 2>/dev/null; then
        echo "Database is ready!"
        break
    fi

    if [ $i -eq $MAX_RETRIES ]; then
        echo "ERROR: Database not available after $MAX_RETRIES attempts"
        exit 1
    fi

    echo "Attempt $i/$MAX_RETRIES - Database not ready, waiting ${RETRY_INTERVAL}s..."
    sleep $RETRY_INTERVAL
done

# Run migrations
echo "Running database migrations..."
alembic upgrade head

# Start the server
PORT=${PORT:-8000}
echo "Starting server on port $PORT..."
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
