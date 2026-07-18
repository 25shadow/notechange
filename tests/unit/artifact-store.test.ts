import { Readable } from 'node:stream';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error The standalone Node service is intentionally plain ESM JavaScript.
import { readArtifact, storeArtifact, validateArtifactName } from '../../license-server/artifact-store.mjs';

describe('artifact store', () => {
  it('rejects path traversal and stores a release with SHA-512 metadata', async () => {
    expect(validateArtifactName('../secret')).toBeNull();
    expect(validateArtifactName('NoteChange-1.2.0.exe')).toBe('NoteChange-1.2.0.exe');
    const root = await mkdtemp(join(tmpdir(), 'notechange-artifact-'));
    const stored = await storeArtifact(root, Readable.from('hello'), 'NoteChange-1.2.0.exe');
    expect(stored).toEqual({
      name: 'NoteChange-1.2.0.exe',
      path: 'releases/NoteChange-1.2.0.exe',
      sha512: createHash('sha512').update('hello').digest('base64'),
      size: 5
    });
    const artifact = await readArtifact(root, stored.name);
    expect(await readFile(artifact!.file, 'utf8')).toBe('hello');
  });
});
