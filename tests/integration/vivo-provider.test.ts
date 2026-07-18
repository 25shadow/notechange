import { describe, expect, it } from 'vitest';

import vivoContractJson from '../../docs/research/contracts/vivo-notes.contract.json';
import { parseProviderContract } from '../../src/main/contracts/loader';
import type { ProviderContract } from '../../src/main/contracts/schema';
import {
  VivoApi,
  type VivoContractExecutor
} from '../../src/main/providers/vivo/vivo-api';
import { VivoProvider } from '../../src/main/providers/vivo/vivo-provider';
import { normalizeContent } from '../../src/main/migration/content';
import createSuccess from '../fixtures/vivo/create-success.json';
import syncState from '../fixtures/vivo/sync-state.json';

class FakeExecutor implements VivoContractExecutor {
  readonly calls: Array<{ operation: string; payload: unknown }> = [];

  async call<T>(operation: { name: string }, payload: unknown): Promise<T> {
    this.calls.push({ operation: operation.name, payload });
    if (operation.name === 'getSyncState') return syncState as T;
    if (operation.name === 'createSync') return createSuccess as T;
    throw new Error(`UNEXPECTED_OPERATION:${operation.name}`);
  }
}

const canonicalNote = {
  sourceId: 'source-1',
  folderSourceId: null,
  title: '合成笔记',
  html: '<p>仅用于测试</p>',
  plainText: '仅用于测试',
  attachments: [],
  createdAt: '2026-07-14T00:00:00.000Z',
  modifiedAt: '2026-07-14T00:00:00.000Z',
  contentHash: 'a'.repeat(64),
  warnings: []
};

function withVerifiedCreate(contract: ProviderContract): ProviderContract {
  return {
    ...contract,
    operations: contract.operations.map((operation) =>
      operation.name === 'createSync'
        ? { ...operation, verification: 'network-verified' as const }
        : operation
    )
  };
}

function withUnverifiedCreate(contract: ProviderContract): ProviderContract {
  return {
    ...contract,
    operations: contract.operations.map((operation) =>
      operation.name === 'createSync'
        ? { ...operation, verification: 'source-verified' as const }
        : operation
    )
  };
}

describe('VivoProvider', () => {
  it('默认拒绝尚未网络验证的 createSync', async () => {
    const contract = withUnverifiedCreate(parseProviderContract(vivoContractJson));
    const provider = new VivoProvider(new VivoApi(new FakeExecutor(), contract));

    await expect(provider.upsertNote(canonicalNote, '0')).rejects.toThrow(
      'CONTRACT_WRITE_NOT_VERIFIED:createSync'
    );
  });

  it('使用同步状态构造 createSync 普通笔记请求', async () => {
    const executor = new FakeExecutor();
    const contract = withVerifiedCreate(parseProviderContract(vivoContractJson));
    const provider = new VivoProvider(new VivoApi(executor, contract));

    const result = await provider.upsertNote(canonicalNote, '0');

    expect(executor.calls[0]).toEqual({ operation: 'getSyncState', payload: { type: 0 } });
    expect(executor.calls[1]).toMatchObject({
      operation: 'createSync',
      payload: {
        type: 0,
        lastUpdateCount: 7,
        noteBooks: [],
        tags: [],
        resources: []
      }
    });
    expect(executor.calls[1]?.payload).not.toHaveProperty('jvq_param');
    expect(result.targetId).toBe('synthetic-target-1');
  });

  it('将小米纯文本笔记作为段落内容写入 createSync', async () => {
    const executor = new FakeExecutor();
    const contract = withVerifiedCreate(parseProviderContract(vivoContractJson));
    const provider = new VivoProvider(new VivoApi(executor, contract));
    const content = normalizeContent('第一段\n第二段');

    await provider.upsertNote({ ...canonicalNote, ...content }, '0');

    expect(executor.calls[1]).toMatchObject({
      operation: 'createSync',
      payload: { notes: [{ content: '<p>第一段</p><p>第二段</p>' }] }
    });
  });

  it('不会静默丢弃尚未支持上传的图片附件', async () => {
    const executor = new FakeExecutor();
    const contract = withVerifiedCreate(parseProviderContract(vivoContractJson));
    const provider = new VivoProvider(new VivoApi(executor, contract));

    await expect(
      provider.upsertNote(
        {
          ...canonicalNote,
          attachments: [
            {
              sourceId: 'image-1',
              mimeType: 'image/png',
              filename: 'synthetic.png',
              sha256: 'b'.repeat(64),
              localPath: '/synthetic/image'
            }
          ]
        },
        '0'
      )
    ).rejects.toThrow('VIVO_ATTACHMENTS_UNSUPPORTED');
    expect(executor.calls).toEqual([]);
  });
});
