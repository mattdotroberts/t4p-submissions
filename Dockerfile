FROM node:22-alpine

WORKDIR /app

COPY server.js index.html ./
COPY assets ./assets

ENV PORT=3000
EXPOSE 3000

VOLUME /app/data

CMD ["node", "server.js"]
