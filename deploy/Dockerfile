FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY tsconfig.json ./
COPY db ./db
COPY server ./server
COPY bot ./bot
COPY web ./web
RUN npx vite build web
EXPOSE 3000
CMD ["npx", "tsx", "server/src/main.ts"]
