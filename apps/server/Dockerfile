# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# deps：全部依赖（含 devDependencies，供 build 使用）。
# 注意：pnpm 对缺失的 workspace 包 manifest 不报错（留悬空 symlink），所以 server/dto 直接依赖的
# workspace 包（@moment/dto、config/ 下的 @moment/typescript-config、@moment/eslint-config）的
# manifest 必须全部在下方 COPY 清单内——今后 server/dto 新增任何 workspace 依赖，必须同步本清单
# （deps 与 prod-deps 两处），否则静默拿到悬空依赖。
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY config config
COPY packages/dto/package.json packages/dto/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/dto packages/dto
COPY apps/server apps/server
RUN pnpm --filter @moment/dto build && pnpm --filter @moment/server build

# prod-deps：仅生产依赖（manifest 清单与 deps 保持一致）。
# 取舍声明：runtime 只带 prod node_modules——不把 jest/tsx/typescript 等 devDependencies
# 打进运行镜像（体积与攻击面约减半）；代价是多一个 install 阶段（构建缓存下开销可忽略）。
FROM base AS prod-deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY config config
COPY packages/dto/package.json packages/dto/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --prod

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/dto ./packages/dto
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/packages/dto/dist ./packages/dto/dist
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/drizzle ./apps/server/drizzle
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
WORKDIR /app/apps/server
EXPOSE 3000
CMD ["node", "dist/index.js"]
