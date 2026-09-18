# Imagen única: compila el cliente y corre la API + WebSocket, que también sirve el juego compilado.
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

# DATABASE_URL llega por variables de entorno (docker-compose.prod.yml)
CMD ["npx", "tsx", "server/src/index.ts"]
