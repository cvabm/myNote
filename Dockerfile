# ---- frontend build ----
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com

# package.json 含 "mynote": "file:.."，需要根 package.json
COPY package.json ./
COPY frontend/package.json frontend/package-lock.json ./frontend/
WORKDIR /app/frontend
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ---- backend build ----
FROM node:20-bookworm-slim AS backend-build
WORKDIR /app

# 京东云等国内环境：apt 走阿里云，避免 deb.debian.org 超时
RUN set -eux; \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's/deb.debian.org/mirrors.aliyun.com/g; s/security.debian.org/mirrors.aliyun.com/g' \
        /etc/apt/sources.list.d/debian.sources; \
    fi; \
    if [ -f /etc/apt/sources.list ]; then \
      sed -i 's/deb.debian.org/mirrors.aliyun.com/g; s/security.debian.org/mirrors.aliyun.com/g' \
        /etc/apt/sources.list; \
    fi; \
    apt-get update --allow-releaseinfo-change -qq; \
    apt-get install -y --no-install-recommends python3 make g++; \
    rm -rf /var/lib/apt/lists/*

RUN npm config set registry https://registry.npmmirror.com

COPY package.json ./
COPY backend/package.json backend/package-lock.json ./backend/
WORKDIR /app/backend
# better-sqlite3 在此阶段编译一次即可
RUN npm ci

COPY backend/ ./
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/app/data/mynote.db \
    UPLOAD_DIR=/app/data/uploads \
    STATIC_DIR=/app/public \
    TZ=Asia/Shanghai

# 直接复用已编译产物，不再 apt / npm install
COPY --from=backend-build /app/package.json ./
COPY --from=backend-build /app/backend/package.json ./backend/
COPY --from=backend-build /app/backend/node_modules ./backend/node_modules
COPY --from=backend-build /app/backend/dist ./backend/dist
COPY --from=frontend-build /app/frontend/dist ./public

RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3001
WORKDIR /app/backend
CMD ["node", "dist/index.js"]
