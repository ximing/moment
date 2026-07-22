import { createServer, type Server } from 'node:http';
import type { Express } from 'express';
import { afterAll, beforeAll } from '@jest/globals';

/**
 * 为什么必须显式绑 127.0.0.1：
 * supertest 对未 listen 的 app 会自行 `app.listen(0)`（不指定 host，macOS 上绑 `::` IPv6
 * 通配），随后固定拨 `http://127.0.0.1:<port>`（supertest lib/test.js serverAddress）。
 * 本机代理类进程（如 Dumbo）在 127.0.0.1 上持有 ephemeral 监听端口时，macOS SO_REUSEADDR
 * 语义允许 `:::P` 与 `127.0.0.1:P` 静默共存，内核把 IPv4 loopback 流量投递给更具体的外源
 * socket —— 测试请求被外源进程 404/405 应答。碰撞率约 0.1%/请求，单文件必过、全量数千次
 * 请求随机命中 1~2 次，表现为排序依赖的「DB 隔离 flake」。
 * 显式绑 127.0.0.1 后，port-0 分配器会跳过外源已占端口（EADDRINUSE 语义），且绑定后外源
 * 无法再抢同地址，竞争彻底消除。supertest 对已 listen 的 server（address() 非空）不会重新
 * listen，直接复用其端口。
 *
 * 本模块在 import 时向所在测试文件注册一对 beforeAll/afterAll：beforeAll 等所有模块作用域
 * server 完成 listening（消除 supertest 因 address() 为空而二次 listen 的 race），afterAll
 * 统一关闭全部 server，避免 open handle 挂住 jest。
 */

const servers = new Set<Server>();
const pendingListens: Promise<void>[] = [];

/**
 * 包一层 express app，绑 127.0.0.1 的随机端口，返回 http.Server（可直接传给 supertest）。
 * 供测试文件模块作用域使用（`const app = listenLocal(createApp())`）；listening 由模块级
 * beforeAll 保证在首个测试前完成。测试体内临时建 server 请用 listenLocalReady。
 */
export function listenLocal(app: Express): Server {
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  servers.add(server);
  pendingListens.push(
    new Promise<void>((resolve, reject) => {
      if (server.listening) {
        resolve();
        return;
      }
      server.once('listening', () => resolve());
      server.once('error', reject);
    }),
  );
  return server;
}

/** 异步变体：在测试体内临时建 server 时使用，返回前保证已 listening。 */
export async function listenLocalReady(app: Express): Promise<Server> {
  const server = createServer(app);
  servers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1');
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  return server;
}

beforeAll(async () => {
  await Promise.all(pendingListens);
});

afterAll(async () => {
  const list = [...servers];
  servers.clear();
  await Promise.all(
    list.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        }),
    ),
  );
});
