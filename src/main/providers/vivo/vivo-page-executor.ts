import type { Page } from 'playwright';
import { readFile } from 'node:fs/promises';

import type { OperationContract } from '../../contracts/schema';
import type { VivoContractExecutor } from './vivo-api';

export class VivoPageExecutor implements VivoContractExecutor {
  constructor(private readonly page: Page) {}

  async call<T>(operation: OperationContract, payload: unknown): Promise<T> {
    if (operation.name === 'uploadAttachment') {
      return this.uploadAttachment(payload) as Promise<T>;
    }
    if (operation.name === 'downloadAttachment') {
      return this.downloadAttachment(payload) as Promise<T>;
    }
    return this.page.evaluate(
      async ({ contractOperation, requestPayload }) => {
        type OfficialRequire = (moduleId: number) => Record<string, unknown>;
        type VivoWindow = Window & {
          webpackJsonp?: { push(chunk: unknown[]): void };
          __notechangeWebpackRequire?: OfficialRequire;
        };
        const vivoWindow = window as VivoWindow;

        if (!vivoWindow.__notechangeWebpackRequire) {
          if (!vivoWindow.webpackJsonp) throw new Error('VIVO_OFFICIAL_MODULE_UNAVAILABLE');
          vivoWindow.webpackJsonp.push([
            [987654],
            {
              987654: (
                _module: unknown,
                _exports: unknown,
                require: OfficialRequire
              ) => {
                vivoWindow.__notechangeWebpackRequire = require;
              }
            },
            [[987654]]
          ]);
        }

        const require = vivoWindow.__notechangeWebpackRequire;
        if (!require) throw new Error('VIVO_OFFICIAL_MODULE_UNAVAILABLE');

        if (contractOperation.name === 'createSync') {
          const syncModule = require(1281) as {
            createSync?: (value: unknown) => Promise<T>;
          };
          if (!syncModule.createSync) throw new Error('VIVO_CREATE_SYNC_UNAVAILABLE');
          return syncModule.createSync(requestPayload);
        }

        if (contractOperation.name === 'listNotes' || contractOperation.name === 'getNote') {
          const noteModule = require(102) as {
            fetchNoteList?: (value: unknown) => Promise<T>;
            getNote?: (guid: string) => Promise<T>;
          };
          if (contractOperation.name === 'listNotes') {
            if (!noteModule.fetchNoteList) throw new Error('VIVO_NOTE_LIST_UNAVAILABLE');
            return noteModule.fetchNoteList(requestPayload);
          }
          const guid = (requestPayload as { guid?: unknown }).guid;
          if (!noteModule.getNote || typeof guid !== 'string') {
            throw new Error('VIVO_NOTE_CONTENT_UNAVAILABLE');
          }
          return noteModule.getNote(guid);
        }

        const requestModule = require(137) as {
          default?: {
            requestBranch?: (options: Record<string, unknown>) => Promise<T>;
          };
        };
        const requestBranch = requestModule.default?.requestBranch;
        if (!requestBranch) throw new Error('VIVO_REQUEST_BRANCH_UNAVAILABLE');
        return requestBranch({
          url: contractOperation.path,
          syncName: contractOperation.name,
          method: contractOperation.method,
          data: requestPayload,
          encrypt: contractOperation.wireBodyKeys?.includes('jvq_param') === true,
          optimize: false
        });
      },
      { contractOperation: operation, requestPayload: payload }
    );
  }

  private async uploadAttachment(payload: unknown): Promise<{
    metaId: string;
    domain: string;
    fileSize: number;
  }> {
    const attachment = parseAttachmentPayload(payload);
    const bytes = await readFile(attachment.localPath);
    return this.page.evaluate(
      async ({ filename, mimeType, base64 }) => {
        type OfficialRequire = (moduleId: number) => Record<string, unknown>;
        type UploadResult = {
          status?: string;
          metaId?: string;
          domain?: string;
          fileSize?: number;
          errcode?: string;
        };
        type VivoWindow = Window & {
          webpackJsonp?: { push(chunk: unknown[]): void };
          __notechangeWebpackRequire?: OfficialRequire;
        };
        const vivoWindow = window as VivoWindow;
        if (!vivoWindow.__notechangeWebpackRequire) {
          if (!vivoWindow.webpackJsonp) throw new Error('VIVO_OFFICIAL_MODULE_UNAVAILABLE');
          vivoWindow.webpackJsonp.push([
            [987654],
            { 987654: (_module: unknown, _exports: unknown, require: OfficialRequire) => {
              vivoWindow.__notechangeWebpackRequire = require;
            } },
            [[987654]]
          ]);
        }
        const require = vivoWindow.__notechangeWebpackRequire;
        const FileUpload = require?.(324).default as
          | (new (options: { files: File[]; onFinish: (result: UploadResult) => void }) => {
              start(): Promise<void>;
            })
          | undefined;
        if (!FileUpload) throw new Error('VIVO_FILE_UPLOAD_UNAVAILABLE');
        const binary = atob(base64);
        const data = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index);
        const file = new File([data], filename, { type: mimeType, lastModified: Date.now() });
        return new Promise<{ metaId: string; domain: string; fileSize: number }>((resolve, reject) => {
          const uploader = new FileUpload({
            files: [file],
            onFinish: (result) => {
              if (result.status !== 'success' || !result.metaId || !result.domain) {
                reject(new Error(`VIVO_ATTACHMENT_UPLOAD_FAILED:${result.errcode ?? result.status ?? 'unknown'}`));
                return;
              }
              resolve({
                metaId: result.metaId,
                domain: result.domain,
                fileSize: result.fileSize ?? file.size
              });
            }
          });
          void uploader.start().catch(() => reject(new Error('VIVO_ATTACHMENT_UPLOAD_FAILED')));
        });
      },
      { filename: attachment.filename, mimeType: attachment.mimeType, base64: bytes.toString('base64') }
    );
  }

  private async downloadAttachment(payload: unknown): Promise<number[]> {
    const attachment = parseAttachmentPayload(payload);
    const resourceKey = attachment.providerMetadata?.resourceKey;
    if (!resourceKey) throw new Error('VIVO_ATTACHMENT_RESOURCE_KEY_MISSING');
    return this.page.evaluate(
      async ({ resourceKey, domain, filename }) => {
        type OfficialRequire = (moduleId: number) => Record<string, unknown>;
        type VivoWindow = Window & {
          webpackJsonp?: { push(chunk: unknown[]): void };
          __notechangeWebpackRequire?: OfficialRequire;
        };
        const vivoWindow = window as VivoWindow;
        if (!vivoWindow.__notechangeWebpackRequire) {
          if (!vivoWindow.webpackJsonp) throw new Error('VIVO_OFFICIAL_MODULE_UNAVAILABLE');
          vivoWindow.webpackJsonp.push([
            [987654],
            { 987654: (_module: unknown, _exports: unknown, require: OfficialRequire) => {
              vivoWindow.__notechangeWebpackRequire = require;
            } },
            [[987654]]
          ]);
        }
        const DownloadFile = vivoWindow.__notechangeWebpackRequire?.(3544).default as
          | (new (options: {
              saveType: number;
              metaInfos: Array<{ metaId: string; domain?: string; filename: string }>;
              onFinish: (entry: { status?: string }, blob?: Blob) => void;
            }) => { start(): Promise<void> })
          | undefined;
        if (!DownloadFile) throw new Error('VIVO_FILE_DOWNLOAD_UNAVAILABLE');
        return new Promise<number[]>((resolve, reject) => {
          let settled = false;
          const finish = (entry: { status?: string }, blob?: Blob) => {
            if (settled) return;
            settled = true;
            if (entry.status !== 'success' || !blob) {
              reject(new Error(`VIVO_ATTACHMENT_DOWNLOAD_FAILED:${entry.status ?? 'unknown'}`));
              return;
            }
            void blob.arrayBuffer().then(
              (buffer) => resolve(Array.from(new Uint8Array(buffer))),
              () => reject(new Error('VIVO_ATTACHMENT_DOWNLOAD_FAILED:read'))
            );
          };
          const downloader = new DownloadFile({
            saveType: 2,
            metaInfos: [{ metaId: resourceKey, ...(domain ? { domain } : {}), filename }],
            onFinish: finish
          });
          void downloader.start().catch(() => {
            if (!settled) {
              settled = true;
              reject(new Error('VIVO_ATTACHMENT_DOWNLOAD_FAILED'));
            }
          });
        });
      },
      { resourceKey, domain: attachment.providerMetadata?.domain ?? '', filename: attachment.filename }
    );
  }
}

function parseAttachmentPayload(payload: unknown): {
  filename: string;
  mimeType: string;
  localPath: string;
  providerMetadata?: Record<string, string>;
} {
  if (!payload || typeof payload !== 'object') throw new Error('VIVO_ATTACHMENT_INVALID');
  const { filename, mimeType, localPath, providerMetadata } = payload as Record<string, unknown>;
  if (typeof filename !== 'string' || typeof mimeType !== 'string' || typeof localPath !== 'string') {
    throw new Error('VIVO_ATTACHMENT_INVALID');
  }
  const metadata = providerMetadata && typeof providerMetadata === 'object'
    ? Object.fromEntries(Object.entries(providerMetadata).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : undefined;
  return { filename, mimeType, localPath, providerMetadata: metadata };
}
