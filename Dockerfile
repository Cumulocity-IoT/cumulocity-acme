FROM node:18-alpine

WORKDIR /usr/app

RUN apk add openssl wget curl acme.sh --no-cache

COPY ./ ./
RUN npm install && npm run build && rm -r src && npm prune --production

CMD ["node", "."]