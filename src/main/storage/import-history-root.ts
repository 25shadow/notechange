import { join } from 'node:path';

export function importHistoryRoot(userDataDirectory: string): string {
  return join(userDataDirectory, 'import-history');
}
