FROM node:22-alpine

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY package*.json ./

RUN npm config set registry https://mirrors.cloud.tencent.com/npm/ \
  && npm ci

COPY . .

RUN npm run build \
  && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=80
ENV AOTD_WORKBOOK_PATH=data/AOTD_500_Song_Library_Enhanced.xlsx

EXPOSE 80

CMD ["npm", "start"]
