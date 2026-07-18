import type { Page } from 'playwright';
import { readFile } from 'node:fs/promises';

import { runSameOrigin } from '../../browser/same-origin-executor';
import type { OperationContract } from '../../contracts/schema';
import type { XiaomiContractExecutor, XiaomiRequest } from './xiaomi-api';

export class XiaomiPageExecutor implements XiaomiContractExecutor {
  constructor(private readonly page: Page) {}

  async call<T>(operation: OperationContract, request: XiaomiRequest): Promise<T> {
    if (operation.name === 'uploadImage') return this.uploadImage(request) as Promise<T>;
    const path = resolvePath(operation.path, request.pathParameters);
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(request.query ?? {})) {
      query.set(key, String(value));
    }
    const requestPath = query.size > 0 ? `${path}?${query.toString()}` : path;

    if (operation.name === 'downloadImage') {
      const envelope = await runSameOrigin<KssEnvelope>(this.page, requestPath, {
        method: 'GET'
      });
      if (envelope.code !== 0) throw new Error(`XIAOMI_API_${envelope.code}`);
      const kss = envelope.data?.kss;
      if (kss?.stat !== 'OK' || !Array.isArray(kss.blocks) || kss.blocks.length === 0) {
        throw new Error('XIAOMI_KSS_METADATA_INVALID');
      }
      const key = Buffer.from(kss.secure_key, 'hex');
      if (key.length === 0 || key.toString('hex') !== kss.secure_key.toLowerCase()) {
        throw new Error('XIAOMI_KSS_KEY_INVALID');
      }
      const decryptedBlocks: Buffer[] = [];
      for (const block of kss.blocks) {
        const url = block.urls?.[0];
        if (!url) throw new Error('XIAOMI_KSS_BLOCK_URL_MISSING');
        const response = await this.page.request.get(url);
        if (!response.ok()) throw new Error(`HTTP_${response.status()}`);
        decryptedBlocks.push(rc4(Buffer.from(await response.body()), key));
      }
      return new Uint8Array(Buffer.concat(decryptedBlocks)) as T;
    }

    const body = request.body ? new URLSearchParams(request.body).toString() : undefined;
    return runSameOrigin<T>(this.page, requestPath, {
      method: operation.method,
      headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
      body
    });
  }

  private async uploadImage(request: XiaomiRequest): Promise<{ fileId: string; digest: string; mimeType: string }> {
    const attachment = parseUploadRequest(request);
    if (new URL(this.page.url()).hostname.endsWith('account.xiaomi.com')) {
      throw new Error('AUTH_EXPIRED');
    }
    const bytes = await readFile(attachment.localPath);
    return this.page.evaluate(
      async ({ filename, mimeType, base64 }) => {
        type OfficialRequire = (moduleId: string) => Record<string, unknown>;
        type XiaomiWindow = Window & {
          webpackJsonp?: { push(chunk: unknown[]): void };
          __notechangeWebpackRequire?: OfficialRequire;
        };
        type OfficialHttp = {
          post?: (path: string, data: Record<string, string>) => Promise<unknown>;
        };
        const xiaomiWindow = window as XiaomiWindow;
        if (!xiaomiWindow.__notechangeWebpackRequire) {
          if (!xiaomiWindow.webpackJsonp) throw new Error('XIAOMI_OFFICIAL_MODULE_UNAVAILABLE');
          xiaomiWindow.webpackJsonp.push([
            [987653],
            { 987653: (_module: unknown, _exports: unknown, require: OfficialRequire) => {
              xiaomiWindow.__notechangeWebpackRequire = require;
            } },
            [[987653]]
          ]);
        }
        const require = xiaomiWindow.__notechangeWebpackRequire;
        const http = require?.('iR4f') as OfficialHttp | undefined;
        const hashFile = require?.('oq9Y').f as ((file: File) => Promise<{
          total: number;
          sha1: string;
          hashList: Array<{ blob: Blob }>;
          encryptInfo?: unknown;
        }>) | undefined;
        if (!http?.post || !hashFile) throw new Error('XIAOMI_IMAGE_UPLOAD_UNAVAILABLE');
        const binary = atob(base64);
        const raw = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) raw[index] = binary.charCodeAt(index);
        const file = new File([raw], filename, { type: mimeType, lastModified: Date.now() });
        const hashed = await hashFile(file);
        const uploadRequest = {
          type: 'note_img',
          storage: {
            filename: file.name,
            size: hashed.total,
            sha1: hashed.sha1,
            mimeType: file.type,
            kss: { block_infos: hashed.hashList }
          },
          ...(hashed.encryptInfo ? { encryptInfo: hashed.encryptInfo } : {})
        };
        const initial = await http.post('/file/v2/user/request_upload_file', {
          data: JSON.stringify(uploadRequest),
          ...(hashed.encryptInfo ? { encryptInfo: JSON.stringify(hashed.encryptInfo) } : {})
        }) as {
          fileId?: string;
          digest?: string;
          mimeType?: string;
          storage?: { uploadId: string; kss: { node_urls: string[]; file_meta: string; block_metas: Array<{ is_existed?: number; commit_meta?: string; block_meta: string }> } };
        };
        if (initial.fileId && initial.digest) {
          return { fileId: initial.fileId, digest: initial.digest, mimeType: initial.mimeType || file.type };
        }
        const storage = initial.storage;
        if (!storage?.uploadId || !storage.kss.node_urls[0]) throw new Error('XIAOMI_IMAGE_UPLOAD_SESSION_INVALID');
        const commitMetas: Array<{ commit_meta: string }> = [];
        for (let index = 0; index < storage.kss.block_metas.length; index += 1) {
          const block = storage.kss.block_metas[index]!;
          if (block.is_existed === 1 && block.commit_meta) {
            commitMetas.push({ commit_meta: block.commit_meta });
            continue;
          }
          const blob = hashed.hashList[index]?.blob;
          if (!blob) throw new Error('XIAOMI_IMAGE_UPLOAD_BLOCK_MISSING');
          const response = await fetch(
            `${storage.kss.node_urls[0]}/upload_block_chunk?chunk_pos=0&&file_meta=${encodeURIComponent(storage.kss.file_meta)}&block_meta=${encodeURIComponent(block.block_meta)}`,
            { method: 'POST', headers: { 'Content-type': 'application/octet-stream' }, mode: 'cors', body: blob }
          );
          if (!response.ok) throw new Error(`XIAOMI_IMAGE_UPLOAD_BLOCK_FAILED:${response.status}`);
          const committed = await response.json() as { commit_meta?: string };
          if (!committed.commit_meta) throw new Error('XIAOMI_IMAGE_UPLOAD_COMMIT_META_MISSING');
          commitMetas.push({ commit_meta: committed.commit_meta });
        }
        const completed = await http.post('file/v2/user/commit', {
          commit: JSON.stringify({
            storage: {
              uploadId: storage.uploadId,
              size: hashed.total,
              sha1: hashed.sha1,
              kss: { file_meta: storage.kss.file_meta, commit_metas: commitMetas }
            }
          }),
          ...(hashed.encryptInfo ? { encryptInfo: JSON.stringify(hashed.encryptInfo) } : {})
        }) as { fileId?: string; digest?: string };
        if (!completed.fileId || !completed.digest) throw new Error('XIAOMI_IMAGE_UPLOAD_COMMIT_INVALID');
        return { fileId: completed.fileId, digest: completed.digest, mimeType: file.type };
      },
      { filename: attachment.filename, mimeType: attachment.mimeType, base64: bytes.toString('base64') }
    );
  }
}

type KssEnvelope = {
  code: number;
  data?: {
    kss?: {
      stat?: string;
      secure_key: string;
      blocks: Array<{ urls?: string[] }>;
    };
  };
};

function rc4(input: Uint8Array, key: Uint8Array): Buffer {
  const state = Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + state[i] + key[i % key.length]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
  }
  const output = Buffer.alloc(input.length);
  let i = 0;
  j = 0;
  for (let offset = 0; offset < input.length; offset += 1) {
    i = (i + 1) & 0xff;
    j = (j + state[i]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
    output[offset] = input[offset] ^ state[(state[i] + state[j]) & 0xff];
  }
  return output;
}

function resolvePath(path: string, parameters: Record<string, string> = {}): string {
  const resolved = path.replace(/:([A-Za-z0-9_]+)/g, (_match, key: string) => {
    const value = parameters[key];
    if (!value) throw new Error(`CONTRACT_PATH_PARAMETER_MISSING:${key}`);
    return encodeURIComponent(value);
  });
  if (resolved.includes(':')) throw new Error('CONTRACT_PATH_UNRESOLVED');
  return resolved;
}

function parseUploadRequest(request: XiaomiRequest): { filename: string; mimeType: string; localPath: string } {
  const { filename, mimeType, localPath } = request.attachment ?? {};
  if (typeof filename !== 'string' || typeof mimeType !== 'string' || typeof localPath !== 'string') {
    throw new Error('XIAOMI_IMAGE_UPLOAD_INVALID');
  }
  return { filename, mimeType, localPath };
}
