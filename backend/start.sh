#!/bin/bash
set -e

# Run migrations
echo "Running Prisma migrations..."
npx prisma migrate deploy

# Start the appropriate service based on ROLE environment variable
if [ "$ROLE" = "SYSTEM_MANAGER" ]; then
  echo "Starting System-Manager on port $PORT..."
  node src/system-manager/index.js
elif [ "$ROLE" = "EDGE" ]; then
  echo "Starting Edge Server on port $PORT..."
  node src/edge/index.js
else
  # Default to Origin
  echo "Starting Origin Server on port $PORT..."
  node src/origin/index.js
fi
