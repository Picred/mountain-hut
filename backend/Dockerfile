FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG SESSION_SECRET
ENV SESSION_SECRET=${SESSION_SECRET}

COPY package*.json ./
RUN npm_config_build_from_source=true npm ci --omit=dev

COPY . .

RUN mkdir -p /app/db && npm run db:init

EXPOSE 3001

CMD ["node", "index.js"]