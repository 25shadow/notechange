import { assertWriteVerified } from '../../contracts/loader';
import type { OperationContract, ProviderContract } from '../../contracts/schema';
import { z } from 'zod';
import type { SourceAttachment } from '../provider';

const listEntrySchema = z.object({
  id: z.string(),
  folderId: z.union([z.number(), z.string(), z.null()]),
  subject: z.string(),
  createDate: z.number(),
  modifyDate: z.number()
});

const attachmentEntrySchema = z.object({
  digest: z.string(),
  fileId: z.string(),
  mimeType: z.string()
});

const noteEntrySchema = listEntrySchema.extend({
  content: z.string(),
  extraInfo: z.string().optional().default(''),
  encryptInfo: z.unknown().optional(),
  setting: z.object({ data: z.array(attachmentEntrySchema).default([]) })
});

const listDataSchema = z.object({
  entries: z.array(listEntrySchema),
  folders: z.array(z.unknown()),
  lastPage: z.boolean(),
  syncTag: z.string()
});

const noteDataSchema = z.object({ entry: noteEntrySchema });
const createdDataSchema = z.object({
  entry: z.object({ id: z.string(), modifyDate: z.number().optional() })
});
const uploadedImageSchema = z.object({
  fileId: z.string().min(1),
  digest: z.string().min(1),
  mimeType: z.string().min(1)
});

export type XiaomiRequest = {
  query?: Record<string, string | number>;
  body?: Record<string, string>;
  pathParameters?: Record<string, string>;
  attachment?: SourceAttachment & { localPath: string };
};

export interface XiaomiContractExecutor {
  call<T>(operation: OperationContract, request: XiaomiRequest): Promise<T>;
}

export type XiaomiEnvelope<T> = {
  code: number;
  data: T;
  retriable?: boolean;
};

export type XiaomiListEntry = {
  id: string;
  folderId: number | string | null;
  subject: string;
  createDate: number;
  modifyDate: number;
};

export type XiaomiAttachmentEntry = {
  digest: string;
  fileId: string;
  mimeType: string;
};

export type XiaomiNoteEntry = XiaomiListEntry & {
  content: string;
  extraInfo: string;
  encryptInfo?: unknown;
  setting: { data: XiaomiAttachmentEntry[] };
};

export class XiaomiApi {
  constructor(
    private readonly executor: XiaomiContractExecutor,
    private readonly contract: ProviderContract
  ) {
    if (contract.provider !== 'xiaomi') throw new Error('CONTRACT_PROVIDER_MISMATCH:xiaomi');
  }

  async hasData(): Promise<unknown> {
    return this.call<unknown>('hasData', {});
  }

  async listNotes(syncTag?: string) {
    const query: Record<string, string | number> = { limit: 200, ts: Date.now() };
    if (syncTag) query.syncTag = syncTag;
    const data = await this.call<unknown>('listNotes', { query });
    return this.parseResponse('listNotes', listDataSchema, data);
  }

  async getNote(id: string) {
    const data = await this.call<unknown>('getNote', {
      pathParameters: { id },
      query: { ts: Date.now() }
    });
    return this.parseResponse('getNote', noteDataSchema, data);
  }

  async downloadImage(fileId: string): Promise<Uint8Array> {
    const operation = this.operation('downloadImage');
    return this.execute(operation, {
      query: { type: 'note_img', fileid: fileId }
    });
  }

  async uploadImage(attachment: SourceAttachment & { localPath: string }): Promise<XiaomiAttachmentEntry> {
    const response = await this.execute<unknown>(this.operation('uploadImage'), { attachment });
    return this.parseResponse('uploadImage', uploadedImageSchema, response);
  }

  async createFolder(entry: string): Promise<{ entry: { id: string } }> {
    const operation = this.operation('createFolder');
    assertWriteVerified(operation);
    const data = this.unwrap(
      await this.execute<XiaomiEnvelope<unknown>>(operation, { body: { entry } })
    );
    return this.parseResponse('createFolder', createdDataSchema, data);
  }

  async createNote(entry: string): Promise<{ entry: { id: string; modifyDate?: number } }> {
    const operation = this.operation('createNote');
    assertWriteVerified(operation);
    const data = this.unwrap(
      await this.execute<XiaomiEnvelope<unknown>>(operation, { body: { entry } })
    );
    return this.parseResponse('createNote', createdDataSchema, data);
  }

  private async call<T>(name: string, request: XiaomiRequest): Promise<T> {
    const response = await this.execute<XiaomiEnvelope<T>>(this.operation(name), request);
    return this.unwrap(response);
  }

  private async execute<T>(operation: OperationContract, request: XiaomiRequest): Promise<T> {
    try {
      return await this.executor.call<T>(operation, request);
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

  private unwrap<T>(response: XiaomiEnvelope<T>): T {
    if (response.code !== 0) {
      throw new Error(response.retriable ? 'RATE_LIMITED' : `XIAOMI_API_${response.code}`);
    }
    return response.data;
  }

  private parseResponse<T extends z.ZodType>(
    operation: string,
    schema: T,
    value: unknown
  ): z.infer<T> {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((issue) => {
          const received = valueAtPath(value, issue.path);
          const receivedType = Array.isArray(received)
            ? 'array'
            : received === null
              ? 'null'
              : typeof received;
          return `${issue.path.join('.') || '<root>'}:${issue.code}:${receivedType}`;
        })
        .join(',');
      throw new Error(`XIAOMI_RESPONSE_INVALID:${operation}:${issues}`);
    }
    return parsed.data;
  }
}

function valueAtPath(value: unknown, path: PropertyKey[]): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}
