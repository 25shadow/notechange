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
    if (operation.name === 'listNotes') {
      return {
        notes: [
          {
            guid: 'vivo-note-1',
            noteBookGuid: '0',
            title: 'vivo 合成标题',
            contentDigest: 'vivo 合成正文',
            createTime: 1720915200000,
            updateTime: 1720915260000,
            deleted: 1,
            encryptType: 0
          }
        ],
        chunkLowTime: 0
      } as T;
    }
    if (operation.name === 'getNote') return '<p>vivo 合成正文</p>' as T;
    if (operation.name === 'downloadAttachment') return [137, 80, 78, 71] as T;
    if (operation.name === 'uploadAttachment') {
      return {
        metaId: 'synthetic-meta-1',
        domain: 'https://synthetic-upload.example',
        fileSize: 3
      } as T;
    }
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

function fixtureAttachment() {
  return {
    sourceId: 'image-1',
    mimeType: 'image/png',
    filename: 'synthetic.png',
    sha256: 'b'.repeat(64),
    localPath: '/synthetic/image'
  };
}

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
  it('读取并映射已验证的 vivo 笔记列表和正文', async () => {
    const executor = new FakeExecutor();
    const provider = new VivoProvider(
      new VivoApi(executor, parseProviderContract(vivoContractJson))
    );

    const page = await provider.listNotes();
    const note = await provider.getNote('vivo-note-1');

    expect(executor.calls[0]).toMatchObject({
      operation: 'listNotes',
      payload: { maxEntries: 1000, syncProtocolVersion: 200 }
    });
    expect(executor.calls[1]).toEqual({ operation: 'getNote', payload: { guid: 'vivo-note-1' } });
    expect(page).toEqual({
      items: [{ sourceId: 'vivo-note-1', folderSourceId: null }],
      nextCursor: null
    });
    expect(note).toMatchObject({
      sourceId: 'vivo-note-1',
      title: 'vivo 合成标题',
      html: '<p>vivo 合成正文</p>',
      plainText: 'vivo 合成正文',
      createdAt: '2024-07-14T00:00:00.000Z',
      modifiedAt: '2024-07-14T00:01:00.000Z'
    });
  });

  it('兼容官网列表的 data 信封和数字型笔记字段', async () => {
    const contract = parseProviderContract(vivoContractJson);
    const provider = new VivoProvider(
      new VivoApi(
        {
          async call<T>(operation: { name: string }) {
            if (operation.name === 'listNotes') {
              return {
                data: {
                  notes: [{
                    guid: 'vivo-note-number-fields',
                    noteBookGuid: 0,
                    title: null,
                    contentDigest: null,
                    createTime: '1720915200000',
                    updateTime: '1720915260000',
                    deleted: '1',
                    encryptType: '0',
                    resources: null
                  }],
                  chunkLowTime: '0'
                }
              } as T;
            }
            if (operation.name === 'getNote') return '正文' as T;
            throw new Error(`UNEXPECTED_OPERATION:${operation.name}`);
          }
        },
        contract
      )
    );

    await expect(provider.listNotes()).resolves.toEqual({
      items: [{ sourceId: 'vivo-note-number-fields', folderSourceId: null }],
      nextCursor: null
    });
  });

  it('将 vivo 图片资源导出为可下载附件和正文占位', async () => {
    const executor = new FakeExecutor();
    const provider = new VivoProvider(
      new VivoApi(executor, parseProviderContract(vivoContractJson))
    );
    await provider.listNotes();
    const listedCall = executor.calls.at(-1);
    if (!listedCall || listedCall.operation !== 'listNotes') throw new Error('LIST_CALL_MISSING');
    (listedCall.payload as never);
    const originalCall = executor.call.bind(executor);
    let downloadPayload: unknown;
    executor.call = async <T>(operation: { name: string }, payload: unknown): Promise<T> => {
      if (operation.name === 'listNotes') {
        return {
          notes: [{
            guid: 'vivo-resource-note',
            title: '带图片',
            contentDigest: '',
            noteBookGuid: '0',
            createTime: 1,
            updateTime: 1,
            deleted: 1,
            resources: [{
              guid: 'vivo-image-1',
              resourceKey: 'vivo-meta-1',
              fileID: 'vivo-meta-1',
              domainAddr: 'https://files.vivo.example',
              name: 'image.png',
              mime: 'png',
              category: 3
            }]
          }]
        } as T;
      }
      if (operation.name === 'getNote') return '<p>正文</p><vnote-image guid="vivo-image-1"></vnote-image>' as T;
      if (operation.name === 'downloadAttachment') {
        downloadPayload = payload;
        return [137, 80, 78, 71] as T;
      }
      return originalCall(operation, payload);
    };

    await provider.listNotes();
    const note = await provider.getNote('vivo-resource-note');
    const downloaded = await provider.downloadAttachment(note.attachments[0]!);

    expect(note.html).toContain('https://notechange.invalid/attachment/vivo-image-1');
    expect(note.attachments[0]).toMatchObject({
      sourceId: 'vivo-image-1',
      filename: 'image.png',
      mimeType: 'image/png'
    });
    expect(downloaded).toMatchObject({ localPath: expect.any(String), sha256: expect.any(String) });
    expect(downloadPayload).toMatchObject({ sourceId: 'vivo-image-1' });
    await provider.dispose();
  });

  it('兼容官方同步层嵌套 result/data 的列表响应', async () => {
    const provider = new VivoProvider(
      new VivoApi(
        {
          async call<T>(operation: { name: string }) {
            if (operation.name === 'listNotes') {
              return { result: { data: { notes: [{ guid: 101, deleted: 1 }] } } } as T;
            }
            throw new Error(`UNEXPECTED_OPERATION:${operation.name}`);
          }
        },
        parseProviderContract(vivoContractJson)
      )
    );

    await expect(provider.listNotes()).resolves.toEqual({
      items: [{ sourceId: '101', folderSourceId: null }],
      nextCursor: null
    });
  });

  it('不把 vivo 的 chunkLowTime 当作分页游标', async () => {
    const provider = new VivoProvider(
      new VivoApi(
        {
          async call<T>(operation: { name: string }) {
            if (operation.name === 'listNotes') {
              return { notes: [{ guid: 'only-once', deleted: 1 }], chunkLowTime: 123 } as T;
            }
            throw new Error(`UNEXPECTED_OPERATION:${operation.name}`);
          }
        },
        parseProviderContract(vivoContractJson)
      )
    );

    await expect(provider.listNotes()).resolves.toEqual({
      items: [{ sourceId: 'only-once', folderSourceId: null }],
      nextCursor: null
    });
  });

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

  it('上传图片并将资源引用写入 vivo 同步笔记', async () => {
    const executor = new FakeExecutor();
    const contract = withVerifiedCreate(parseProviderContract(vivoContractJson));
    const provider = new VivoProvider(new VivoApi(executor, contract));

    await expect(
      provider.upsertNote({ ...canonicalNote, attachments: [fixtureAttachment()] }, '0')
    ).resolves.toMatchObject({ targetId: expect.any(String) });
    expect(executor.calls.map(({ operation }) => operation)).toEqual([
      'getSyncState',
      'uploadAttachment',
      'createSync'
    ]);
    expect(executor.calls[2]).toMatchObject({
      operation: 'createSync',
      payload: {
        resources: [
          expect.objectContaining({
            resourceKey: 'synthetic-meta-1',
            fileID: 'synthetic-meta-1',
            mime: 'png',
            category: 3
          })
        ],
        notes: [
          expect.objectContaining({
            content: expect.stringContaining('vnote-image')
          })
        ]
      }
    });
  });
});
