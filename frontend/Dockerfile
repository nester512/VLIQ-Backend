# ---------------------------------------------------------------------------
# Stage 1: Build — compile TypeScript + Vite bundle
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests first for layer cache.
COPY package.json package-lock.json ./

RUN npm ci

# Copy source and build.
COPY . .

RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: Runtime — serve static files via nginx
# ---------------------------------------------------------------------------
FROM nginx:alpine AS runtime

# Replace default nginx config with SPA + proxy config.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the Vite build output.
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
