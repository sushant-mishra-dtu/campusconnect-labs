# Platform: the API, the WebSocket hub, the SQLite database and the built web app, in one container.
# Build from the repo root:  docker build -f server/Dockerfile .

FROM node:24-trixie-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY labnode/package.json labnode/
RUN npm ci -w web --include=dev --no-audit --no-fund
COPY web web
RUN npm run build -w web

FROM node:24-trixie-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY labnode/package.json labnode/
# tsx runs the TypeScript sources directly, so dev dependencies stay in
RUN npm ci -w server --include=dev --no-audit --no-fund && npm cache clean --force
COPY server server
# Specs, starters and the reference designs the seed signs; read only, never modified here
COPY rtl/challenges rtl/challenges
COPY --from=web /app/web/dist web/dist
RUN chmod +x server/docker-entrypoint.sh && mkdir -p /data /handoff && chown node:node /data /handoff

# CRTL_KEYS_DIR is where the seed leaves the demo node's token for the lab node container
ENV NODE_ENV=production PORT=4000 CRTL_DB=/data/c-rtl.db CRTL_KEYS_DIR=/handoff
USER node
VOLUME ["/data", "/handoff"]
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
ENTRYPOINT ["/app/server/docker-entrypoint.sh"]
CMD ["serve"]
