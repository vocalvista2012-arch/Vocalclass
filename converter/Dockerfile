FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-impress fonts-liberation fonts-dejavu && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.cjs ./
USER node
ENV PORT=8080
CMD ["node","server.cjs"]
