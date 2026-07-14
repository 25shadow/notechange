import { z } from 'zod';

export const verificationSchema = z.enum(['network-verified', 'source-verified']);

export const operationContractSchema = z.object({
  name: z.string().min(1),
  method: z.enum(['GET', 'POST']),
  path: z.string().startsWith('/'),
  verification: verificationSchema,
  queryKeys: z.array(z.string()).optional(),
  bodyKeys: z.array(z.string()).optional(),
  wireBodyKeys: z.array(z.string()).optional(),
  bodyEncoding: z.enum(['form', 'json']).optional(),
  responseShape: z.record(z.string(), z.record(z.string(), z.string())).optional()
});

export const providerContractSchema = z
  .object({
    provider: z.enum(['xiaomi', 'vivo']),
    operations: z.array(operationContractSchema).min(1)
  })
  .passthrough();

export type OperationContract = z.infer<typeof operationContractSchema>;
export type ProviderContract = z.infer<typeof providerContractSchema>;
