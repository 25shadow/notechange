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
      const bytes = await this.page.evaluate(async (assetPath) => {
        const response = await fetch(assetPath, { credentials: 'include' });
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        return [...new Uint8Array(await response.arrayBuffer())];
      }, requestPath);
      return new Uint8Array(bytes) as T;
    }

    const body = request.body ? new URLSearchParams(request.body).toString() : undefined;
    return runSameOrigin<T>(this.page, requestPath, {
      method: operation.method,
      headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
      body
    });
  }
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
