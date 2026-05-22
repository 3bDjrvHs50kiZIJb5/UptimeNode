FROM node:24-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
RUN npm install dotenv --omit=dev --no-audit --no-fund

RUN mkdir -p /app/data /app/logs
COPY src ./src
COPY public ./public
COPY data/sites.json ./data/sites.json

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/index.js"]
