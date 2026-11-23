import { validateApiUrl } from '../../config/api-url';
import { row } from '../chat/types';

export function mediaToken(value: unknown, room: string, development: boolean) {
  const data = row(value);
  if (
    typeof data.url !== 'string' ||
    typeof data.token !== 'string' ||
    !data.token ||
    data.token.length > 16384 ||
    data.room !== room ||
    !Number.isInteger(data.expires_in) ||
    (data.expires_in as number) < 1 ||
    (data.expires_in as number) > 3600
  )
    throw new Error('Could not verify media access.');
  const url = new URL(data.url);
  if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('Invalid media connection.');
  const origin = new URL(url);
  origin.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  validateApiUrl(origin.toString(), development);
  return { url: url.toString(), token: data.token, room };
}
