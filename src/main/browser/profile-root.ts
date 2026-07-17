import { join } from 'node:path';

export function browserProfileRoot(userDataDirectory: string): string {
  return join(userDataDirectory, 'browser-profiles');
}
