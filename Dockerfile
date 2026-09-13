FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 9000

CMD ["npm", "start"]
