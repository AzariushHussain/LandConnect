import { AppState } from 'react-native';
import { permissions } from '@livekit/react-native-webrtc';
import { CallKind } from './api';

export async function prepareCallMedia(kind: CallKind) {
  if ((await permissions.request({ name: 'microphone' })) !== true)
    throw new Error('Microphone access required');
  if (kind === 'video' && (await permissions.request({ name: 'camera' })) !== true)
    throw new Error('Camera access required');
  // Android permission activities can briefly background React Native while returning a result.
  if (AppState.currentState !== 'active')
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        listener.remove();
        reject(new Error('App is backgrounded'));
      }, 5000);
      const listener = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          clearTimeout(timer);
          listener.remove();
          resolve();
        }
      });
      if (AppState.currentState === 'active') {
        clearTimeout(timer);
        listener.remove();
        resolve();
      }
    });
}
