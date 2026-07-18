import type { Page } from 'playwright';

import { runSameOrigin } from '../../browser/same-origin-executor';
import type { OperationContract } from '../../contracts/schema';
import type { XiaomiContractExecutor, XiaomiRequest } from './xiaomi-api';

export class XiaomiPageExecutor implements XiaomiContractExecutor {
  constructor(private readonly page: Page) {}

  async call<T>(operation: OperationContract, request: XiaomiRequest): Promise<T> {
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
