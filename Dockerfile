FROM ghcr.io/cloud-cli/image-node:latest

USER root
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev
RUN mkdir /data && chown -R 1000:1000 /data
USER node
ENV NODE_ENV=production
ENV S3MINI_HOST=0.0.0.0
ENV S3MINI_PORT=9000
EXPOSE 9000
