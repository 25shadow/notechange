const sensitiveKeys = new Set([
  'authorization',
  'body',
  'content',
  'cookie',
  'filename',
  'jvq_param',
  'servicetoken',
  'title',
  'token'
]);

const sensitiveStringPattern = /(?:bearer\s+|cookie\s*[:=]|serviceToken\s*=|jvq_param\s*=)/i;

export function redactForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForLog);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        sensitiveKeys.has(key.toLowerCase()) ? '[REDACTED]' : redactForLog(nestedValue)
      ])
    );
  }
  if (typeof value === 'string' && sensitiveStringPattern.test(value)) return '[REDACTED]';
  return value;
}
