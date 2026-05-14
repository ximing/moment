import { db, pool } from '../../src/db/index.js';
import {
  chainInvites,
  chainMembers,
  chains,
  media,
  moments,
  outbox,
  refreshTokens,
  users,
} from '../../src/db/schema.js';

/** 每个用例前清表：先子表后父表（外键逆序）。仅允许对测试库使用。 */
export async function resetDb(): Promise<void> {
  await db.delete(outbox);
  await db.delete(media);
  await db.delete(moments);
  await db.delete(chainInvites);
  await db.delete(chainMembers);
  await db.delete(chains);
  await db.delete(refreshTokens);
  await db.delete(users);
}

/** 测试文件收尾关闭连接池（不关闭 jest 进程会因 open handle 挂住不退出）。 */
export async function closeDb(): Promise<void> {
  await pool.end();
}
