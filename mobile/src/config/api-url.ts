export function validateApiUrl(value: string | undefined, development: boolean): string {
  if (!value) throw new Error('Set EXPO_PUBLIC_API_URL in mobile/.env.');
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('API URL must be an origin, without credentials, a path or query.');
  }
  const privateV4 = /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;
  const local =
    privateV4.test(url.hostname) || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(development && url.protocol === 'http:' && local)) {
    throw new Error('Use HTTPS, or a private HTTP address in a development build.');
  }
  return url.origin;
}
