import * as SecureStore from 'expo-secure-store';
import { SessionStorage } from './session';

const key = 'landconnect.session.v1';

export const sessionStorage: SessionStorage = {
  read: () => SecureStore.getItemAsync(key),
  write: (value) => SecureStore.setItemAsync(key, value),
  remove: () => SecureStore.deleteItemAsync(key),
};
