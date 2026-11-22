import { ApiClient } from '../api/client';
import { validateApiUrl } from '../config/api-url';
import { AuthApi } from '../features/auth/api';
import { SessionController } from '../features/auth/session';
import { sessionStorage } from '../features/auth/storage';

export const client = new ApiClient(validateApiUrl(process.env.EXPO_PUBLIC_API_URL, __DEV__));
export const authApi = new AuthApi(client);
export const session = new SessionController(authApi, sessionStorage);
