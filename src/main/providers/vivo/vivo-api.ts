import type { Page } from 'playwright';
import { z } from 'zod';

import { assertWriteVerified } from '../../contracts/loader';
import type { OperationContract, ProviderContract } from '../../contracts/schema';
import type { VivoCreateSyncRequest } from './vivo-sync-types';

declare global {
  interface Window {
    VNoteServerMaodun?: { encrypt(value: string): { data: string } };
  }
}

export interface VivoContractExecutor {
  call<T>(operation: OperationContract, payload: unknown): Promise<T>;
}

const syncStateSchema = z.object({ updateCount: z.number() });
const createSyncResponseSchema = z.object({
  updateCount: z.number(),
  notes: z.array(z.object({ guid: z.string() })).min(1)
});

export class VivoApi {
  constructor(
    private readonly executor: VivoContractExecutor,
    private readonly contract: ProviderContract
  ) {
    if (contract.provider !== 'vivo') throw new Error('CONTRACT_PROVIDER_MISMATCH:vivo');
  }

  async getSyncState(type: 0) {
    const response = await this.execute<unknown>('getSyncState', { type });
    return this.parseResponse('getSyncState', syncStateSchema, response);
  }

  async createSync(payload: VivoCreateSyncRequest) {
    const operation = this.operation('createSync');
    assertWriteVerified(operation);
    const response = await this.call<unknown>(operation, payload);
    return this.parseResponse('createSync', createSyncResponseSchema, response);
  }

  private execute<T>(name: string, payload: unknown): Promise<T> {
    return this.call(this.operation(name), payload);
  }

  private async call<T>(operation: OperationContract, payload: unknown): Promise<T> {
    try {
      return await this.executor.call<T>(operation, payload);
    } catch (error) {
      if (error instanceof Error && ['HTTP_401', 'HTTP_403'].includes(error.message)) {
        throw new Error('AUTH_EXPIRED');
      }
      if (error instanceof Error && error.message === 'HTTP_429') {
        throw new Error('RATE_LIMITED');
      }
      throw error;
    }
  }

  private operation(name: string): OperationContract {
    const operation = this.contract.operations.find((candidate) => candidate.name === name);
    if (!operation) throw new Error(`CONTRACT_OPERATION_MISSING:${name}`);
    return operation;
  }

  private parseResponse<T extends z.ZodType>(operation: string, schema: T, value: unknown) {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new Error(`VIVO_RESPONSE_INVALID:${operation}`);
    return parsed.data;
  }
}

export async function vivoPost<T>(
  page: Page,
  path: string,
  payload: unknown
): Promise<T> {
  return page.evaluate(
    async ({ requestPath, businessPayload }) => {
      const encoder = window.VNoteServerMaodun;
      if (!encoder) throw new Error('VIVO_ENVELOPE_UNAVAILABLE');
      const jvqParam = encoder.encrypt(JSON.stringify(businessPayload)).data;
      const response = await fetch(`/note-api${requestPath}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jvq_param: jvqParam })
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      return response.json() as Promise<T>;
    },
    { requestPath: path, businessPayload: payload }
  );
}
