FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build
FROM node:22-alpine
RUN apk add --no-cache mysql-client
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY scripts ./scripts
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/.data && chown -R node:node /app
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["npm","start"]
