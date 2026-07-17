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
    throw new Error(`UNEXPECTED_OPERATION:${operation.name}`);
  }
}

function createProvider() {
  const executor = new FakeExecutor();
  const contract = parseProviderContract(xiaomiContractJson);
  return { executor, provider: new XiaomiProvider(new XiaomiApi(executor, contract)) };
}

describe('XiaomiProvider', () => {
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
