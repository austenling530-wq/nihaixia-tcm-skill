FROM node:20-slim

WORKDIR /app
ENV TZ=Asia/Shanghai

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
