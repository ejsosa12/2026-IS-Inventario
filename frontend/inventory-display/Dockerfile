# Development image: runs `ng serve` (later replaced by a build + nginx stage)
FROM node:24-slim

WORKDIR /app

# Same caching trick as the backend: install dependencies before copying the code
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 4200

# --host 0.0.0.0 so the browser on the host can reach the dev server inside the container
CMD ["npx", "ng", "serve", "--host", "0.0.0.0", "--port", "4200"]
