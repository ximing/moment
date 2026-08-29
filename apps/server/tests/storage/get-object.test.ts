import { MAX_IMAGE_BYTES } from '@moment/dto';
import type { StorageMetadata } from '../../src/storage/base.adapter.js';
import { getStorage, setStorageAdapter } from '../../src/storage/factory.js';
import { installMockStorage } from '../helpers/storage.js';

afterEach(() => setStorageAdapter(null));

const meta: StorageMetadata = {
  bucket: 'b',
  prefix: 'p',
  region: 'us-east-1',
  isPublicBucket: 'false',
};

describe('installMockStorage getObject（spec §2.4）', () => {
  it('默认返回空 Buffer；可 mockResolvedValue', async () => {
    const storage = installMockStorage();
    await expect(storage.getObject('k', meta, MAX_IMAGE_BYTES)).resolves.toEqual(Buffer.alloc(0));
    storage.getObject.mockResolvedValueOnce(Buffer.from('webp'));
    await expect(getStorage().getObject('k', meta, 4)).resolves.toEqual(Buffer.from('webp'));
    expect(storage.getObject).toHaveBeenCalledWith('k', meta, 4);
  });
});
