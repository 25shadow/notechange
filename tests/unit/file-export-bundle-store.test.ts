import { mkdtemp, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CanonicalNote } from '../../src/shared/domain';
import type { ExportBundle } from '../../src/main/migration/orchestrator';
import { FileExportBundleStore } from '../../src/main/storage/file-export-bundle-store';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('FileExportBundleStore', () => {
  it('原子保存完整批次并去重相同附件', async () => {
    const { root, bundle } = await fixture();
    const store = new FileExportBundleStore(join(root, 'exports'));

    const saved = await store.save(bundle);
    const restored = await store.loadLatest();

    expect(saved).toMatchObject({ noteCount: 2, attachmentCount: 2, warningCount: 0 });
    expect(await readdir(join(root, 'exports', saved.batchId, 'attachments'))).toHaveLength(1);
    expect(restored?.bundle.notes).toHaveLength(2);
    expect(restored?.bundle.notes[0]?.attachments[0]?.localPath).toContain(saved.batchId);
  });

  it('拒绝损坏的本地笔记 JSON', async () => {
    const { root, bundle } = await fixture();
    const store = new FileExportBundleStore(join(root, 'exports'));
    const saved = await store.save(bundle);
    await writeFile(join(root, 'exports', saved.batchId, 'notes.json'), '{invalid', 'utf8');

    await expect(store.loadLatest()).rejects.toThrow('LOCAL_EXPORT_INVALID');
  });

  it('拒绝附件文件缺失的批次', async () => {
    const { root, bundle } = await fixture();
    const store = new FileExportBundleStore(join(root, 'exports'));
    const saved = await store.save(bundle);
    const attachmentDirectory = join(root, 'exports', saved.batchId, 'attachments');
    const [attachment] = await readdir(attachmentDirectory);
    await unlink(join(attachmentDirectory, attachment));

    await expect(store.loadLatest()).rejects.toThrow('LOCAL_EXPORT_INVALID');
  });
});

async function fixture(): Promise<{ root: string; bundle: ExportBundle }> {
  const root = await mkdtemp(join(tmpdir(), 'notechange-export-store-'));
  roots.push(root);
  const attachment = join(root, 'source.png');
  await writeFile(attachment, new Uint8Array([1, 2, 3]), { mode: 0o600 });
  const sha256 = 'a'.repeat(64);
  const note = (sourceId: string): CanonicalNote => ({
    sourceId,
    folderSourceId: null,
    title: `合成标题 ${sourceId}`,
    html: '<p>合成正文</p>',
    plainText: '合成正文',
    attachments: [{ sourceId: `file-${sourceId}`, filename: 'image.png', mimeType: 'image/png', sha256, localPath: attachment }],
    createdAt: '2026-07-17T00:00:00.000Z',
    modifiedAt: '2026-07-17T00:00:00.000Z',
    contentHash: 'b'.repeat(64),
    warnings: []
  });
  return {
    root,
    bundle: { notes: [note('n1'), note('n2')], attachmentCount: 2, warningCount: 0 }
  };
}
