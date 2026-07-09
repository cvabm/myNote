# ---- frontend build ----
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---- backend build ----
FROM node:20-bookworm-slim AS backend-build
WORKDIR /app/backend
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY backend/package.json ./
RUN npm install
COPY backend/ ./
RUN npm run build \
  && npm prune --omit=dev

# ---- runtime ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/app/data/mynote.db \
    UPLOAD_DIR=/app/data/uploads \
    STATIC_DIR=/app/public \
    TZ=Asia/Shanghai

COPY backend/package.json ./backend/
WORKDIR /app/backend
RUN npm install --omit=dev
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=frontend-build /app/frontend/dist /app/public

RUN mkdir -p /app/data

VOLUME ["/app/data"]
EXPOSE 3001

WORKDIR /app/backend
CMD ["node", "dist/index.js"]
