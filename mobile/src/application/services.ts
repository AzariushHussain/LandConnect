import { ApiClient } from '../api/client';
import { validateApiUrl } from '../config/api-url';
import { AuthApi } from '../features/auth/api';
import { SessionController } from '../features/auth/session';
import { sessionStorage } from '../features/auth/storage';
import { ListingsApi } from '../features/listings/api';
import { ManagementApi } from '../features/management/api';
import { MapsApi } from '../features/maps/api';
import { ChatApi } from '../features/chat/api';
import { ChatRealtime } from '../features/chat/realtime';
import { PrivacyApi } from '../features/privacy/api';
import { active, CallsApi } from '../features/calls/api';
import { CallController } from '../features/calls/controller';
import { randomUUID } from 'expo-crypto';
import { MeetingsApi } from '../features/meetings/api';
import { MeetingSession } from '../features/meetings/session';
import { prepareCallMedia } from '../features/calls/permissions';
import { GroupCallController } from '../features/calls/group-controller';

export const client = new ApiClient(validateApiUrl(process.env.EXPO_PUBLIC_API_URL, __DEV__));
export const authApi = new AuthApi(client);
export const session = new SessionController(authApi, sessionStorage);
export const listingsApi = new ListingsApi(client);
export const managementApi = new ManagementApi(client, session);
export const mapsApi = new MapsApi(client);
export const chatApi = new ChatApi(client, session);
export const privacyApi = new PrivacyApi(client, session);
export const callsApi = new CallsApi(client, session, __DEV__);
const prepareSessionMedia = async (kind: 'audio' | 'video') => {
  const token = session.access()?.token;
  if (!token) throw new Error('Sign in before calling');
  await prepareCallMedia(kind);
  if (session.access()?.token !== token)
    throw new Error('Session changed during permission request');
};
export const calls: CallController = new CallController(
  callsApi,
  () => session.access()?.user.id,
  randomUUID,
  () =>
    meetingSession.getSnapshot().joined ||
    meetingSession.getSnapshot().joining ||
    groupCalls.getSnapshot().busy,
  prepareSessionMedia,
);
export const meetingsApi = new MeetingsApi(client, session, __DEV__);
export const meetingSession: MeetingSession = new MeetingSession(
  meetingsApi,
  () => session.access()?.user.id,
  () =>
    active(calls.getSnapshot().call) || !!calls.getSnapshot().attempt || calls.getSnapshot().busy,
);
export const realtime = new ChatRealtime(client.baseUrl, session, (url) => new WebSocket(url));
export const groupCalls = new GroupCallController(
  meetingsApi,
  meetingSession,
  () => session.access()?.user.id,
  randomUUID,
  () =>
    active(calls.getSnapshot().call) || !!calls.getSnapshot().attempt || calls.getSnapshot().busy,
  prepareSessionMedia,
);
