import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

const operationSchema = z.object({
  name: z.string().min(1),
  method: z.enum(['GET', 'POST']),
  path: z.string().startsWith('/'),
  verification: z.enum(['network-verified', 'source-verified']),
  queryKeys: z.array(z.string()).optional(),
  bodyKeys: z.array(z.string()).optional(),
  wireBodyKeys: z.array(z.string()).optional(),
  bodyEncoding: z.enum(['form', 'json']).optional(),
  responseShape: z.record(z.string(), z.record(z.string(), z.string())).optional()
});

const contractSchema = z
  .object({
    provider: z.enum(['xiaomi', 'vivo']),
    operations: z.array(operationSchema).min(1)
  })
  .passthrough();

const contractPaths = [
  'docs/research/contracts/xiaomi-notes.contract.json',
  'docs/research/contracts/vivo-notes.contract.json'
];

const sensitiveValuePattern = /(cookie|bearer\s+|serviceToken=|jvq_param=)/i;
const realIdPathPattern = /\/(?:\d{8,}|[a-f\d]{16,}|[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12})(?:\/|$)/i;

function stringValues(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringValues);
  return [];
}

for (const relativePath of contractPaths) {
  const source = await readFile(resolve(relativePath), 'utf8');
  const contract = contractSchema.parse(JSON.parse(source));
  const operationNames = contract.operations.map(({ name }) => name);

  if (new Set(operationNames).size !== operationNames.length) {
    throw new Error(`CONTRACT_DUPLICATE_OPERATION:${contract.provider}`);
  }

  if (contract.operations.some(({ path }) => realIdPathPattern.test(path))) {
    throw new Error(`CONTRACT_CONTAINS_REAL_ID:${contract.provider}`);
  }

  if (stringValues(contract).some((value) => sensitiveValuePattern.test(value))) {
    throw new Error(`CONTRACT_CONTAINS_SECRET_VALUE:${contract.provider}`);
  }
}

console.log(`${contractPaths.length} provider contracts valid`);
