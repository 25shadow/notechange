import { join } from 'node:path';

export function exportRoot(userDataDirectory: string): string {
  return join(userDataDirectory, 'exports');
}
