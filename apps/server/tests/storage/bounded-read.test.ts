import { jest } from '@jest/globals';
import { Readable } from 'node:stream';
import { ObjectTooLargeError, abortS3Body, readBodyWithLimit } from '../../src/storage/bounded-read.js';

async function* chunksOf(...parts: string[]): AsyncIterable<Uint8Array> {
  for (const p of parts) yield Buffer.from(p);
}

describe('readBodyWithLimit', () => {
  it('拼接所有 chunk，总长 == maxBytes 合法', async () => {
    const buf = await readBodyWithLimit(chunksOf('hel', 'lo'), 5, 'k');
    expect(buf.toString()).toBe('hello');
  });

  it('空 body 返回空 Buffer', async () => {
    const buf = await readBodyWithLimit(chunksOf(), 10, 'k');
    expect(buf.length).toBe(0);
  });

  it('总长超过 maxBytes → ObjectTooLargeError，不返回部分缓冲', async () => {
    await expect(readBodyWithLimit(chunksOf('hello', 'world'), 8, 'chains/a/b/c.jpg')).rejects.toMatchObject({
      name: 'ObjectTooLargeError',
      message: 'OBJECT_TOO_LARGE',
      key: 'chains/a/b/c.jpg',
      maxBytes: 8,
    });
    expect(new ObjectTooLargeError('k', 1)).toBeInstanceOf(Error);
  });

  it('单 chunk 就超限也抛', async () => {
    await expect(readBodyWithLimit(chunksOf('abcd'), 3, 'k')).rejects.toBeInstanceOf(ObjectTooLargeError);
  });
});

describe('abortS3Body', () => {
  it('对带 destroy 的流调用 destroy，不抛', () => {
    const r = Readable.from([Buffer.from('x')]);
    const spy = jest.spyOn(r, 'destroy');
    abortS3Body(r);
    expect(spy).toHaveBeenCalled();
  });

  it('对 null / 无 destroy 的对象静默', () => {
    expect(() => abortS3Body(null)).not.toThrow();
    expect(() => abortS3Body({})).not.toThrow();
  });
});
