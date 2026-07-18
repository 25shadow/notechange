import { z } from 'zod';

import { assertWriteVerified } from '../../contracts/loader';
import type { OperationContract, ProviderContract } from '../../contracts/schema';
import type { VivoCreateSyncRequest } from './vivo-sync-types';
import type { SourceAttachment } from '../provider';

export interface VivoContractExecutor {
  call<T>(operation: OperationContract, payload: unknown): Promise<T>;
}

const syncStateSchema = z.object({ updateCount: z.number() });
const numericField = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value),
  z.number()
);
const vivoListNoteSchema = z.object({
  guid: z.union([z.string(), z.number()]).transform(String),
  noteBookGuid: z.union([z.string(), z.number()]).optional().default('0').transform(String),
  title: z.string().nullable().optional().transform((value) => value ?? ''),
  contentDigest: z.string().nullable().optional().transform((value) => value ?? ''),
  createTime: numericField.optional().default(0),
  updateTime: numericField.optional().default(0),
  deleted: numericField.optional().default(1),
  encryptType: numericField.optional().default(0),
  resources: z.array(z.object({
    guid: z.union([z.string(), z.number()]).optional().default('').transform(String),
    resourceKey: z.union([z.string(), z.number()]).optional().default('').transform(String),
    fileID: z.union([z.string(), z.number()]).optional().default('').transform(String),
    domainAddr: z.string().nullable().optional().transform((value) => value ?? ''),
    name: z.string().nullable().optional().transform((value) => value ?? ''),
    mime: z.string().nullable().optional().transform((value) => value ?? ''),
    category: numericField.optional().default(0)
  })).nullable().optional().transform((value) => value ?? [])
});
const listNotesResponseSchema = z.preprocess(
  findNotesPayload,
  z.object({
    notes: z.array(vivoListNoteSchema),
    chunkLowTime: numericField.optional()
  })
);
const createSyncResponseSchema = z.object({
  updateCount: z.number(),
  notes: z.array(z.object({ guid: z.string() })).min(1)
});
const uploadedAttachmentSchema = z.object({
  metaId: z.string().min(1),
  domain: z.string().min(1),
  fileSize: z.number().nonnegative()
});
const downloadedAttachmentSchema = z.array(z.number().int().min(0).max(255));

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

  async listNotes(chunkLowTime?: number) {
    const payload: Record<string, number> = {
      maxEntries: 1000,
      syncProtocolVersion: 200
    };
    if (chunkLowTime && chunkLowTime > 0) payload.chunkLowTime = chunkLowTime;
    const response = await this.execute<unknown>('listNotes', payload);
    return this.parseResponse('listNotes', listNotesResponseSchema, response);
  }

  async getNote(guid: string): Promise<unknown> {
    return this.execute<unknown>('getNote', { guid });
  }

  async uploadAttachment(attachment: SourceAttachment & { localPath: string }) {
    const response = await this.execute<unknown>('uploadAttachment', attachment);
    return this.parseResponse('uploadAttachment', uploadedAttachmentSchema, response);
  }

  async downloadAttachment(attachment: SourceAttachment): Promise<Uint8Array> {
    const response = await this.execute<unknown>('downloadAttachment', attachment);
    return Uint8Array.from(this.parseResponse('downloadAttachment', downloadedAttachmentSchema, response));
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

function findNotesPayload(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const object = value as Record<string, unknown>;
  if (Array.isArray(object.notes)) return object;
  for (const key of ['data', 'result', 'response']) {
    const nested = object[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const found = findNotesPayload(nested);
      if (found && typeof found === 'object' && !Array.isArray(found) && Array.isArray((found as { notes?: unknown }).notes)) {
        return found;
      }
    }
  }
  return value;
}
