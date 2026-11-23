import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api/client';
import { SessionController } from '../src/features/auth/session';
import { User } from '../src/features/auth/types';

const user: User = {
  id: 'user-1',
  email: 'buyer@example.com',
  display_name: 'Buyer',
  role: 'buyer',
  allow_messages: true,
  allow_calls: true,
  created_at: '2026-11-22T00:00:00Z',
};
const credentials = { email: user.email, password: 'long-password-123' };

function fixture(raw: string | null = null) {
  let stored = raw;
  const storage = {
    read: async () => stored,
    write: async (value: string) => {
      stored = value;
    },
    remove: async () => {
      stored = null;
    },
  };
  const api = {
    login: async () => ({ access_token: 'token', token_type: 'bearer' as const, expires_in: 3600 }),
    me: async (_token: string) => user,
  };
  return { storage, api, session: new SessionController(api, storage), stored: () => stored };
}

const saved = () => JSON.stringify({ token: 'stored-token', expiresAt: Date.now() + 3600000 });

test('new install is signed out without an account request', async () => {
  const f = fixture();
  f.api.me = async () => {
    throw new Error('must not be called');
  };
  await f.session.restore();
  assert.equal(f.session.getSnapshot().status, 'signedOut');
});

test('stored sessions are verified on the server before unlocking the app', async () => {
  const f = fixture(saved());
  let finish!: (value: User) => void;
  f.api.me = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const restoring = f.session.restore();
  await Promise.resolve();
  assert.equal(f.session.getSnapshot().status, 'loading');
  finish(user);
  await restoring;
  assert.equal(f.session.getSnapshot().status, 'signedIn');
});

test('corrupt, expired and incomplete saved sessions are erased', async () => {
  for (const raw of [
    'not-json',
    'null',
    '{}',
    JSON.stringify({ token: 'old', expiresAt: Date.now() - 1 }),
  ]) {
    const f = fixture(raw);
    await f.session.restore();
    assert.equal(f.session.getSnapshot().status, 'signedOut');
    assert.equal(f.stored(), null);
  }
});

test('a rejected stored token is erased', async () => {
  const f = fixture(saved());
  f.api.me = async () => {
    throw new ApiError(401, 'expired');
  };
  await f.session.restore();
  assert.equal(f.session.getSnapshot().status, 'signedOut');
  assert.equal(f.stored(), null);
});

test('outages keep storage but lock screens, and restoration can be retried', async () => {
  const raw = saved();
  const f = fixture(raw);
  f.api.me = async () => {
    throw new Error('offline');
  };
  await f.session.restore();
  assert.equal(f.session.getSnapshot().status, 'restoreError');
  assert.equal(f.stored(), raw);
  f.api.me = async () => user;
  await f.session.restore();
  assert.equal(f.session.getSnapshot().status, 'signedIn');
});

test('failed secure storage reads lock screens rather than silently discarding the error', async () => {
  const f = fixture(saved());
  f.storage.read = async () => {
    throw new Error('native read failed');
  };
  await f.session.restore();
  assert.equal(f.session.getSnapshot().status, 'restoreError');
});

test('login persists only token and expiry, after verifying the account', async () => {
  const f = fixture();
  await f.session.signIn(credentials);
  assert.equal(f.session.getSnapshot().status, 'signedIn');
  assert.deepEqual(Object.keys(JSON.parse(f.stored()!)).sort(), ['expiresAt', 'token']);
  assert.ok(!f.stored()!.includes(credentials.password));
  assert.ok(!f.stored()!.includes(user.email));
});

test('failed account verification leaves no persisted token', async () => {
  const f = fixture();
  f.api.me = async () => {
    throw new ApiError(401, 'no account');
  };
  await assert.rejects(f.session.signIn(credentials));
  assert.equal(f.stored(), null);
  assert.notEqual(f.session.getSnapshot().status, 'signedIn');
});

test('failed secure write does not unlock the app', async () => {
  const f = fixture();
  f.storage.write = async () => {
    throw new Error('native write failed');
  };
  await assert.rejects(f.session.signIn(credentials), /securely/);
  assert.equal(f.session.getSnapshot().status, 'signedOut');
});

test('expiry locks the session and clears persisted access', async (context) => {
  let now = 1_000_000;
  context.mock.method(Date, 'now', () => now);
  const f = fixture();
  await f.session.signIn(credentials);
  now += 3_600_000;
  f.session.checkExpiry();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.session.getSnapshot().status, 'signedOut');
  assert.equal(f.stored(), null);
});

test('sign-out wins over an account response still in flight', async () => {
  const f = fixture(saved());
  let finish!: (value: User) => void;
  f.api.me = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const restoring = f.session.restore();
  await Promise.resolve();
  await f.session.signOut();
  finish(user);
  await restoring;
  assert.equal(f.session.getSnapshot().status, 'signedOut');
  assert.equal(f.stored(), null);
});

test('a slow native login write cannot restore credentials after sign-out', async () => {
  const f = fixture();
  let finish!: () => void;
  const write = f.storage.write;
  const started = new Promise<void>((resolve) => {
    f.storage.write = async (value) => {
      resolve();
      await new Promise<void>((done) => {
        finish = done;
      });
      await write(value);
    };
  });
  const signingIn = f.session.signIn(credentials);
  await started;
  const signingOut = f.session.signOut();
  finish();
  await Promise.all([signingIn, signingOut]);
  assert.equal(f.session.getSnapshot().status, 'signedOut');
  assert.equal(f.stored(), null);
});

test('a failed erase blocks continuation until deletion succeeds', async () => {
  const f = fixture(saved());
  const remove = f.storage.remove;
  f.storage.remove = async () => {
    throw new Error('native erase failed');
  };
  await f.session.signOut();
  assert.equal(f.session.getSnapshot().status, 'storageError');
  f.storage.remove = remove;
  await f.session.signOut();
  assert.equal(f.session.getSnapshot().status, 'signedOut');
  assert.equal(f.stored(), null);
});

test('access refuses an expired token before the scheduled expiry callback runs', async (context) => {
  let now = 1_000_000;
  context.mock.method(Date, 'now', () => now);
  const f = fixture();
  await f.session.signIn(credentials);
  assert.equal(f.session.access()?.token, 'token');
  now += 3_600_000;
  assert.equal(f.session.access(), null);
});

test('rejecting an old request token cannot erase a newly signed-in session', async () => {
  const f = fixture(saved());
  await f.session.restore();
  await f.session.signIn(credentials);
  await f.session.rejectToken('stored-token');
  assert.equal(f.session.access()?.token, 'token');
  await f.session.rejectToken('token');
  assert.equal(f.session.access(), null);
  assert.equal(f.stored(), null);
});

test('confirmed privacy changes update only flags without rotating credentials or saving profile data', async () => {
  const f = fixture();
  await f.session.signIn(credentials);
  const before = f.session.getSnapshot(),
    stored = f.stored();
  assert.equal(
    f.session.updatePrivacy('token', user.id, {
      allow_messages: false,
      allow_calls: false,
      role: 'seller',
    } as { allow_messages: boolean; allow_calls: boolean }),
    true,
  );
  const state = f.session.getSnapshot();
  assert.equal(state.status, 'signedIn');
  if (state.status === 'signedIn' && before.status === 'signedIn') {
    assert.equal(state.user.role, 'buyer');
    assert.equal(state.expiresAt, before.expiresAt);
    assert.equal(state.user.allow_messages, false);
  }
  assert.equal(f.stored(), stored);
  assert.equal(f.session.access()?.token, 'token');
  const current = f.session.getSnapshot();
  f.session.updatePrivacy('token', user.id, { allow_messages: false, allow_calls: false });
  assert.equal(f.session.getSnapshot(), current);
});

test('privacy updates cannot change an expired, wrong-account or replaced session', async () => {
  const f = fixture();
  await f.session.signIn(credentials);
  const current = f.session.getSnapshot();
  assert.equal(
    f.session.updatePrivacy('old-token', user.id, { allow_messages: false, allow_calls: false }),
    false,
  );
  assert.equal(
    f.session.updatePrivacy('token', 'another-user', { allow_messages: false, allow_calls: false }),
    false,
  );
  assert.equal(f.session.getSnapshot(), current);
  await f.session.signOut();
  assert.equal(
    f.session.updatePrivacy('token', user.id, { allow_messages: false, allow_calls: false }),
    false,
  );
});
