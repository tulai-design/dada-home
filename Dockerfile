# syntax=docker/dockerfile:1

# ---- 构建 ----
FROM node:24.11.0-alpine AS build
WORKDIR /app
# 扩展 ZIP 由 Node 内置 zlib 生成，无需额外系统打包器。
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY vendor/ ./vendor/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ---- 运行：nginx 托管静态文件，Node 提供同源取数代理 ----
FROM nginx:1.27-alpine
RUN apk add --no-cache nodejs
LABEL org.opencontainers.image.title="dada-home" \
      org.opencontainers.image.description="搭搭：用 AI 搭出来的个人起始页（纯前端，数据只存在本机）" \
      org.opencontainers.image.source="https://github.com/tulai-design/dada-home" \
      org.opencontainers.image.licenses="UNLICENSED"
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
# 容器启动时按环境变量生成 /config.js（Umami 统计等运行时配置）
COPY --chmod=755 docker/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
COPY server/proxy.mjs server/start.mjs /opt/dada/
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
ENTRYPOINT ["node", "/opt/dada/start.mjs"]
CMD []
