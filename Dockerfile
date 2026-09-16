FROM ghcr.io/cloud-cli/image-node:latest

USER root
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev
RUN mkdir -p /data && chown -R node:node /app /data

ENV NODE_ENV=production
EXPOSE 9000

USER node
CMD ["npm", "start"]
