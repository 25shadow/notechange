export type DuplicatePolicy = 'skip' | 'copy' | 'overwrite';

export function isProbableDuplicate(
  source: { contentHash: string },
  target: { contentHash: string }
): boolean {
  return source.contentHash === target.contentHash;
}
