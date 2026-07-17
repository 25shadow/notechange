import { access, mkdir, mkdtemp, readdir, rm, unlink, writeFile } from 'node:fs/promises';
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

  it('按时间倒序列出、读取并逐批删除本地导出', async () => {
    const { root, bundle } = await fixture();
    const exportRoot = join(root, 'exports');
    const store = new FileExportBundleStore(exportRoot);
    const first = await store.save(bundle);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await store.save(bundle);

    expect((await store.list()).map((item) => item.batchId)).toEqual([
      second.batchId,
      first.batchId
    ]);
    await expect(store.load(first.batchId)).resolves.toMatchObject({ batchId: first.batchId });

    await store.delete(second.batchId);
    await expect(store.load(second.batchId)).resolves.toBeNull();
    await expect(store.loadLatest()).resolves.toMatchObject({ batchId: first.batchId });

    await store.delete(first.batchId);
    await expect(store.loadLatest()).resolves.toBeNull();
    await expect(access(join(exportRoot, 'latest.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('忽略临时和损坏目录并拒绝路径穿越删除', async () => {
    const { root, bundle } = await fixture();
    const exportRoot = join(root, 'exports');
    const store = new FileExportBundleStore(exportRoot);
    const saved = await store.save(bundle);
    await mkdir(join(exportRoot, 'unfinished.tmp'));
    await mkdir(join(exportRoot, 'broken-batch'));
    await writeFile(join(exportRoot, 'broken-batch', 'manifest.json'), '{invalid', 'utf8');
    const outside = join(root, 'outside.txt');
    await writeFile(outside, 'keep', 'utf8');

    expect((await store.list()).map((item) => item.batchId)).toEqual([saved.batchId]);
    await expect(store.delete('../outside.txt')).rejects.toThrow('EXPORT_BATCH_ID_INVALID');
    await expect(access(outside)).resolves.toBeUndefined();
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
