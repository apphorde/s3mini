FROM ghcr.io/cloud-cli/image-node:latest

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev
USER root
RUN mkdir /data && chown -R 1000:1000 /data
USER node
ENV NODE_ENV=production
EXPOSE 9000

