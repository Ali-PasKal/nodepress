const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : '—';
}

/** Short, human description of a user agent string (best effort, display only). */
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const has = (needle: string) => userAgent.includes(needle);
  const browser = has('Edg/')
    ? 'Edge'
    : has('Chrome/')
      ? 'Chrome'
      : has('Firefox/')
        ? 'Firefox'
        : has('Safari/')
          ? 'Safari'
          : 'Browser';
  const os = has('Windows')
    ? 'Windows'
    : has('Mac OS X') || has('Macintosh')
      ? 'macOS'
      : has('Android')
        ? 'Android'
        : has('iPhone') || has('iPad')
          ? 'iOS'
          : has('Linux')
            ? 'Linux'
            : 'Unknown OS';
  return `${browser} on ${os}`;
}
