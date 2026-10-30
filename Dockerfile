FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 ACTFLOW_DEMO_AUTH=false ACTFLOW_TEST_MODE=false ACTFLOW_DATA_DIR=/app/data/runtime ACTFLOW_DB_PATH=/app/data/runtime/actflow.sqlite
# Keep tsx for the operator's create-user and consistent-backup commands.
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/data/runtime && chown -R node:node /app/data/runtime
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","node_modules/next/dist/bin/next","start","--hostname","0.0.0.0","--port","3000"]
