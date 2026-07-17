export function parseXiaomiNoteTitle(extraInfo: string): string {
  try {
    const parsed = JSON.parse(extraInfo) as { title?: unknown };
    if (typeof parsed.title !== 'string') return '无标题';
    return parsed.title.trim() || '无标题';
  } catch {
    return '无标题';
  }
}
