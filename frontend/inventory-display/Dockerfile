# Multi-stage build: stage 1 compiles Angular with Node, stage 2 only keeps
# the static files on nginx. The final image has no Node nor node_modules.

# ---- Stage 1: build ----
FROM node:24-slim AS build
WORKDIR /app

# Install dependencies before copying the code (cached until package*.json change)
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx ng build --configuration production

# ---- Stage 2: serve ----
FROM nginx:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/inventory-display/browser /usr/share/nginx/html
EXPOSE 80
