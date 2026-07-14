import { describe, expect, it } from 'vitest';

import { MemoryMigrationCheckpointStore } from '../../src/main/storage/memory-checkpoint-store';

describe('MemoryMigrationCheckpointStore', () => {
  it('只在当前进程中记录迁移状态', async () => {
    const store = new MemoryMigrationCheckpointStore();
    await store.save({
      sourceId: 'source-1',
      contentHash: 'a'.repeat(64),
      status: 'created',
      targetId: 'target-1'
    });

    await expect(store.get('source-1')).resolves.toMatchObject({
      status: 'created',
      targetId: 'target-1'
    });
    await expect(new MemoryMigrationCheckpointStore().get('source-1')).resolves.toBeNull();
  });
});
