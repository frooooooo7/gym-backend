#!/bin/sh
set -e

mkdir -p /app/uploads/exercise-images /app/uploads/avatar-images
chown -R node:node /app/uploads

exec su-exec node "$@"
