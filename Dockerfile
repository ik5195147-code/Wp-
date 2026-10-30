# Baileys এর কিছু ডিপেন্ডেন্সি git থেকে নামে, তাই git ইনস্টল করা আছে
FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .
ENV NODE_ENV=production
CMD ["node", "server.js"]
