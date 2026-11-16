FROM node:22-alpine

WORKDIR /app
COPY client ./client
COPY server.mjs ./server.mjs

ENV NODE_ENV=production
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
