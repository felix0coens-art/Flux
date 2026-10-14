FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 FLUX_DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY index.html manifest.webmanifest sw.js ./
COPY css ./css
COPY js ./js
COPY icons ./icons
COPY fonts ./fonts
COPY server ./server
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/session >/dev/null || exit 1
CMD ["node", "server/server.js"]
