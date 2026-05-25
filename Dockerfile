FROM maven:3.9.9-eclipse-temurin-17 AS backend-build
WORKDIR /src
COPY . .
RUN mvn -pl core -am -DskipTests package

FROM node:20-bookworm-slim AS frontend-build
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openjdk-17-jre-headless tini curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=backend-build /src/core/target/*-exec.jar /app/backend/app.jar
COPY --from=frontend-build /src/frontend /app/frontend
COPY docker/single/ingress-server.mjs /app/ingress/ingress-server.mjs
COPY docker/single/start-single.sh /usr/local/bin/start-single.sh

RUN chmod +x /usr/local/bin/start-single.sh \
    && mkdir -p /app/ingress

ENV NODE_ENV=production
ENV BACKEND_PORT=5077
ENV FRONTEND_PORT=3000
ENV EXTERNAL_PORT=5076
ENV DATA_FOLDER=/config

VOLUME ["/config"]
EXPOSE 5076

HEALTHCHECK --interval=30s --timeout=10s --retries=5 CMD curl --fail http://127.0.0.1:5076/actuator/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/start-single.sh"]
