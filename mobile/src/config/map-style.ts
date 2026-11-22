export const DEFAULT_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
export function validateMapStyle(value?: string): string {
  const raw = value?.trim() || DEFAULT_MAP_STYLE;
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.hash)
      return url.toString();
  } catch {
    /* Use one safe configuration error. */
  }
  throw new Error('Map style must be a public HTTPS URL without credentials or a fragment.');
}
