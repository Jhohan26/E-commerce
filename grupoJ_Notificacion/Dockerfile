FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY examples ./examples
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
ENV PORT=3000 DATABASE_PATH=/app/data/notificaciones.sqlite
EXPOSE 3000
CMD ["node", "src/index.js"]
