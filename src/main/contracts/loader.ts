import { providerContractSchema } from './schema';

export function parseProviderContract(value: unknown) {
  return providerContractSchema.parse(value);
}

export function assertWriteVerified(operation: {
  name: string;
  verification: string;
}): void {
  if (operation.verification !== 'network-verified') {
    throw new Error(`CONTRACT_WRITE_NOT_VERIFIED:${operation.name}`);
  }
}
