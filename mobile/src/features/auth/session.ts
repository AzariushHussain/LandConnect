import { ApiError } from '../../api/client';
import { AuthApi } from './api';
import { Credentials, parseSavedSession, SavedSession, User } from './types';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut'; message?: string }
  | { status: 'signedIn'; user: User; expiresAt: number }
  | { status: 'restoreError'; message: string }
  | { status: 'storageError'; message: string };

export type SessionStorage = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
};

// Kept outside React so async session transitions can be tested without native modules.
export class SessionController {
  private state: SessionState = { status: 'loading' };
  private saved: SavedSession | null = null;
  private listeners = new Set<() => void>();
  private generation = 0;
  private storageTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly api: Pick<AuthApi, 'login' | 'me'>,
    private readonly storage: SessionStorage,
  ) {}

  getSnapshot = (): SessionState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(state: SessionState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  private mutateStorage(action: () => Promise<void>) {
    const operation = this.storageTail.then(action);
    this.storageTail = operation.catch(() => {});
    return operation;
  }

  async restore() {
    const generation = ++this.generation;
    this.update({ status: 'loading' });
    try {
      const raw = await this.storage.read();
      if (generation !== this.generation) return;
      const saved = parseSavedSession(raw);
      if (!saved || saved.expiresAt <= Date.now()) {
        await this.signOut();
        return;
      }
      const user = await this.api.me(saved.token);
      if (generation !== this.generation) return;
      if (saved.expiresAt <= Date.now()) {
        await this.signOut('Your session expired. Please sign in again.');
        return;
      }
      this.saved = saved;
      this.update({ status: 'signedIn', user, expiresAt: saved.expiresAt });
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof ApiError && error.status === 401) {
        await this.signOut('Your session expired. Please sign in again.');
      } else {
        // Preserve a stored session during outages, but do not unlock private screens.
        this.update({
          status: 'restoreError',
          message:
            'Could not restore your session. Reconnect and retry, or sign out of this device.',
        });
      }
    }
  }

  async signIn(credentials: Credentials) {
    const generation = ++this.generation;
    const startedAt = Date.now();
    const response = await this.api.login(credentials);
    const user = await this.api.me(response.access_token);
    if (generation !== this.generation) return;
    const saved = {
      token: response.access_token,
      expiresAt: startedAt + response.expires_in * 1000,
    };
    if (saved.expiresAt <= Date.now()) throw new Error('Your session expired. Please try again.');
    try {
      await this.mutateStorage(() =>
        generation === this.generation
          ? this.storage.write(JSON.stringify(saved))
          : Promise.resolve(),
      );
    } catch {
      if (generation !== this.generation) return;
      await this.signOut('Could not save your session securely. Please try again.');
      throw new Error('Could not save your session securely. Please try again.');
    }
    if (generation !== this.generation) return;
    this.saved = saved;
    this.update({ status: 'signedIn', user, expiresAt: saved.expiresAt });
  }

  async signOut(message?: string) {
    const generation = ++this.generation;
    this.saved = null;
    this.update({ status: 'loading' });
    try {
      // Serialize native writes/deletes so a late login write cannot undo sign-out.
      await this.mutateStorage(() => this.storage.remove());
      if (generation === this.generation) this.update({ status: 'signedOut', message });
    } catch {
      if (generation === this.generation)
        this.update({
          status: 'storageError',
          message:
            'Your session is locked, but this device could not erase it. Retry before continuing.',
        });
    }
  }

  checkExpiry = () => {
    if (this.saved && this.saved.expiresAt <= Date.now())
      void this.signOut('Your session expired. Please sign in again.');
  };
}
