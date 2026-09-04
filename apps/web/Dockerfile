# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# deps：web 构建需要 dto / api-client / icons 的 workspace 包；eslint-config 是 dto 的 devDependency。
# 锁文件还包含 server/app，必须把它们的 package.json 一并 COPY，否则 --frozen-lockfile 对不齐。
# --filter=@moment/web...：不装 @lancedb/lancedb native（alpine+qemu/arm64 会挂死）。
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY config config
COPY packages/dto/package.json packages/dto/
COPY packages/api-client/package.json packages/api-client/
COPY packages/icons/package.json packages/icons/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/app/package.json apps/app/
RUN pnpm install --frozen-lockfile --filter=@moment/web...

FROM deps AS build
COPY packages/dto packages/dto
COPY packages/api-client packages/api-client
COPY packages/icons packages/icons
COPY apps/web apps/web
# 同源部署：浏览器请求相对路径 /api，由 nginx 反代到 server（web CLAUDE.md）
ENV VITE_API_BASE_URL=
RUN pnpm --filter @moment/dto build \
 && pnpm --filter @moment/icons build \
 && pnpm --filter @moment/api-client build \
 && pnpm --filter @moment/web build

FROM nginx:1.27-alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
