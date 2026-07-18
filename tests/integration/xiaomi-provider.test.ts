import { describe, expect, it } from 'vitest';

import xiaomiContractJson from '../../docs/research/contracts/xiaomi-notes.contract.json';
import listPageOne from '../fixtures/xiaomi/list-page-1.json';
import listPageTwo from '../fixtures/xiaomi/list-page-2.json';
import noteResponse from '../fixtures/xiaomi/note.json';
import { parseProviderContract } from '../../src/main/contracts/loader';
import type { OperationContract } from '../../src/main/contracts/schema';
import {
  XiaomiApi,
  type XiaomiContractExecutor,
  type XiaomiRequest
} from '../../src/main/providers/xiaomi/xiaomi-api';
import { XiaomiProvider } from '../../src/main/providers/xiaomi/xiaomi-provider';

class FakeExecutor implements XiaomiContractExecutor {
  readonly calls: Array<{ operation: OperationContract; request: XiaomiRequest }> = [];
  private listPage = 0;

  async call<T>(operation: OperationContract, request: XiaomiRequest): Promise<T> {
    this.calls.push({ operation, request });
    if (operation.name === 'listNotes') {
      return (this.listPage++ === 0 ? listPageOne : listPageTwo) as T;
    }
    if (operation.name === 'getNote') return noteResponse as T;
    if (operation.name === 'createNote') {
      return { code: 0, data: { entry: { id: 'synthetic-target-1' } } } as T;
    }
    if (operation.name === 'downloadImage') return new Uint8Array([1, 2, 3]) as T;
    if (operation.name === 'uploadImage') {
      return {
        fileId: 'xiaomi-uploaded-image-1',
        digest: 'c'.repeat(64),
        mimeType: 'image/png'
      } as T;
    }
    throw new Error(`UNEXPECTED_OPERATION:${operation.name}`);
  }
}

function createProvider() {
  const executor = new FakeExecutor();
  const contract = parseProviderContract(xiaomiContractJson);
  return { executor, provider: new XiaomiProvider(new XiaomiApi(executor, contract)) };
}

describe('XiaomiProvider', () => {
  it('创建笔记时将统一标题写入小米 extraInfo', async () => {
    const { executor, provider } = createProvider();

    await provider.upsertNote({
      sourceId: 'vivo-note-1',
      folderSourceId: null,
      title: '来自 vivo 的标题',
      html: '<p>来自 vivo 的正文</p>',
      plainText: '来自 vivo 的正文',
      attachments: [],
      createdAt: null,
      modifiedAt: null,
      contentHash: 'a'.repeat(64),
      warnings: []
    }, null);

    const entry = JSON.parse(executor.calls[0]?.request.body?.entry ?? '{}') as {
      extraInfo?: string;
    };
    expect(JSON.parse(entry.extraInfo ?? '{}')).toMatchObject({
      title: '来自 vivo 的标题',
      note_content_type: 'common'
    });
  });

  it('上传附件后写入小米图片引用和 setting.data', async () => {
    const { executor, provider } = createProvider();

    await provider.upsertNote({
      sourceId: 'vivo-note-with-image',
      folderSourceId: null,
      title: '带图片的 vivo 笔记',
      html: '<p>图片前</p><img src="https://notechange.invalid/attachment/vivo-image-1"><p>图片后</p>',
      plainText: '图片前图片后',
      attachments: [{
        sourceId: 'vivo-image-1',
        mimeType: 'image/png',
        filename: 'vivo-image.png',
        sha256: 'b'.repeat(64),
        localPath: '/synthetic/vivo-image.png'
      }],
      createdAt: null,
      modifiedAt: null,
      contentHash: 'a'.repeat(64),
      warnings: []
    }, null);

    expect(executor.calls.map(({ operation }) => operation.name)).toEqual([
      'uploadImage',
      'createNote'
    ]);
    const entry = JSON.parse(executor.calls[1]?.request.body?.entry ?? '{}') as {
      content?: string;
      setting?: { data?: Array<{ fileId: string; digest: string; mimeType: string }> };
    };
    expect(entry.content).toContain('custom-img="true"');
    expect(entry.content).toContain('data-fileid="xiaomi-uploaded-image-1"');
    expect(entry.setting?.data).toEqual([{
      fileId: 'xiaomi-uploaded-image-1',
      digest: 'c'.repeat(64),
      mimeType: 'image/png'
    }]);
  });

  it('使用 syncTag 作为唯一分页游标', async () => {
    const { executor, provider } = createProvider();

    const first = await provider.listNotes();
    const second = await provider.listNotes(first.nextCursor ?? undefined);

    expect(first.items).toEqual([{ sourceId: 'synthetic-note-1', folderSourceId: null }]);
    expect(first.nextCursor).toBe('synthetic-cursor-2');
    expect(second.nextCursor).toBeNull();
    expect(executor.calls[1]?.request.query).toMatchObject({
      syncTag: 'synthetic-cursor-2'
    });
    expect(executor.calls[0]?.operation.path).toBe('/note/full/page');
  });

  it('兼容 null 和字符串类型的 folderId', async () => {
    const contract = parseProviderContract(xiaomiContractJson);
    const baseEntry = listPageOne.data.entries[0];
    const provider = new XiaomiProvider(
      new XiaomiApi(
        {
          async call<T>() {
            return {
              code: 0,
              data: {
                ...listPageOne.data,
                entries: [
                  { ...baseEntry, id: 'without-folder', folderId: null },
                  { ...baseEntry, id: 'string-folder', folderId: 'folder-1' }
                ],
                lastPage: true
              }
            } as T;
          }
        },
        contract
      )
    );

    await expect(provider.listNotes()).resolves.toMatchObject({
      items: [
        { sourceId: 'without-folder', folderSourceId: null },
        { sourceId: 'string-folder', folderSourceId: 'folder-1' }
      ]
    });
  });

  it('把正文、时间和图片元数据映射为统一笔记', async () => {
    const { provider } = createProvider();

    const note = await provider.getNote('synthetic-note-1');

    expect(note).toMatchObject({
      sourceId: 'synthetic-note-1',
      folderSourceId: null,
      title: '合成标题一',
      html: '<p>合成正文</p>',
      createdAt: '2024-07-14T00:00:00.000Z',
      modifiedAt: '2024-07-14T00:01:00.000Z'
    });
    expect(note.attachments[0]).toMatchObject({
      sourceId: 'synthetic-file-1',
      mimeType: 'image/png'
    });
  });

  it('无附件笔记缺少 setting.data 时按空数组处理', async () => {
    const contract = parseProviderContract(xiaomiContractJson);
    const api = new XiaomiApi(
      {
        async call<T>() {
          return {
            ...noteResponse,
            data: {
              entry: {
                ...noteResponse.data.entry,
                setting: { stickyTime: 0, themeId: 0, version: 1 }
              }
            }
          } as T;
        }
      },
      contract
    );

    await expect(new XiaomiProvider(api).getNote('synthetic-note-1')).resolves.toMatchObject({
      attachments: []
    });
  });

  it('下载图片时固定使用 note_img 类型', async () => {
    const { executor, provider } = createProvider();

    await provider.downloadAttachment({
      sourceId: 'synthetic-file-1',
      mimeType: 'image/png',
      filename: 'synthetic.png'
    });

    expect(executor.calls[0]?.request.query).toEqual({
      type: 'note_img',
      fileid: 'synthetic-file-1'
    });
    expect(executor.calls[0]?.operation.path).toBe('/file/full/v2');
  });

  it('KSS 解包后保留附件原始类型和文件名', async () => {
    const contract = parseProviderContract(xiaomiContractJson);
    const provider = new XiaomiProvider(
      new XiaomiApi(
        {
          async call<T>() {
            return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) as T;
          }
        },
        contract
      )
    );

    try {
      await expect(
        provider.downloadAttachment({
          sourceId: 'synthetic-jpeg',
          mimeType: 'image/jpeg',
          filename: 'note-image.jpg'
        })
      ).resolves.toMatchObject({ mimeType: 'image/jpeg', filename: 'note-image.jpg' });
    } finally {
      await provider.dispose();
    }
  });

  it('拒绝执行尚未网络验证的文件夹写操作', async () => {
    const { provider } = createProvider();

    await expect(
      provider.createFolder({ sourceId: 'f1', parentSourceId: null, name: '合成文件夹' })
    ).rejects.toThrow('CONTRACT_WRITE_NOT_VERIFIED:createFolder');
  });

  it.each([
    ['HTTP_401', 'AUTH_EXPIRED'],
    ['HTTP_429', 'RATE_LIMITED']
  ])('把 %s 转换为 %s', async (sourceError, expectedError) => {
    const contract = parseProviderContract(xiaomiContractJson);
    const api = new XiaomiApi(
      {
        async call() {
          throw new Error(sourceError);
        }
      },
      contract
    );

    await expect(api.listNotes()).rejects.toThrow(expectedError);
  });

  it('拒绝字段结构错误的列表响应', async () => {
    const contract = parseProviderContract(xiaomiContractJson);
    const api = new XiaomiApi(
      {
        async call<T>() {
          return { code: 0, data: { entries: 'invalid' } } as T;
        }
      },
      contract
    );

    await expect(api.listNotes()).rejects.toThrow('XIAOMI_RESPONSE_INVALID:listNotes');
  });
});
