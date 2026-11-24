import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient, ApiError } from '../src/api/client';
import { AuthApi } from '../src/features/auth/api';
import { validateApiUrl } from '../src/config/api-url';
import {
  credentialErrors,
  registrationErrors,
  validateCredentials,
  validateRegistration,
} from '../src/features/auth/validation';
import type { Registration } from '../src/features/auth/types';

test('release refuses HTTP, and development only allows local HTTP origins', () => {
  assert.equal(validateApiUrl('https://api.example.com/', false), 'https://api.example.com');
  assert.equal(validateApiUrl('http://192.168.29.22:8000', true), 'http://192.168.29.22:8000');
  for (const value of [
    undefined,
    'http://example.com',
    'https://user:pass@example.com',
    'https://api.example.com/auth',
    'https://api.example.com/?token=secret',
    'ftp://localhost',
  ]) {
    assert.throws(() => validateApiUrl(value, true));
  }
  assert.throws(() => validateApiUrl('http://192.168.29.22:8000', false));
});

test('JSON requests use explicit tokens and public requests have no authorization header', async () => {
  const calls: RequestInit[] = [];
  const client = new ApiClient('https://api.example.com', async (_url, options) => {
    calls.push(options!);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  await client.request('/auth/login', { body: { email: 'test@example.com', password: 'private' } });
  await client.request('/users/me', { token: 'session-token' });
  assert.ok(calls[0]);
  assert.ok(calls[1]);
  assert.equal(calls[0].method, 'POST');
  assert.equal(new Headers(calls[0].headers).get('Authorization'), null);
  assert.equal(new Headers(calls[1].headers).get('Authorization'), 'Bearer session-token');
  assert.equal(calls[1].body, undefined);
});

test('server errors do not echo response bodies or submitted passwords', async () => {
  const client = new ApiClient(
    'https://api.example.com',
    async () => new Response('secret-password', { status: 422 }),
  );
  await assert.rejects(
    client.request('/auth/register', { body: { password: 'secret-password' } }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 422);
      assert.ok(!error.message.includes('secret-password'));
      return true;
    },
  );
});

test('network failures return a safe retry message', async () => {
  const client = new ApiClient('https://api.example.com', async () => {
    throw new Error('native error with sensitive data');
  });
  await assert.rejects(client.request('/users/me'), /Check your connection/);
});

test('stalled requests are aborted after twelve seconds', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new ApiClient(
    'https://api.example.com',
    async (_url, options) =>
      new Promise((_resolve, reject) => {
        options!.signal!.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  const request = client.request('/users/me');
  const rejected = assert.rejects(request, /Check your connection/);
  context.mock.timers.tick(12_000);
  await rejected;
});

test('invalid successful auth payloads cannot create a session', async () => {
  const client = new ApiClient('https://api.example.com', async () => new Response('{}'));
  const api = new AuthApi(client);
  await assert.rejects(
    api.login({ email: 'a@example.com', password: 'password' }),
    /invalid session/,
  );
  await assert.rejects(api.me('token'), /verify your account/);
});

test('registration matches backend password/name constraints and requires confirmation', () => {
  const data = {
    email: 'buyer@example.com',
    password: 'long-password-123',
    display_name: 'Buyer',
    role: 'buyer' as const,
  };
  assert.equal(validateRegistration(data, data.password), null);
  assert.match(validateRegistration({ ...data, password: 'short' }, 'short')!, /12/);
  assert.match(validateRegistration(data, 'different')!, /do not match/);
  assert.match(validateRegistration({ ...data, display_name: ' ' }, data.password)!, /name/);
});

test('auth forms report every invalid field without echoing submitted values', () => {
  const errors = registrationErrors(
    { email: 'invalid', password: 'secret', display_name: ' ', role: 'buyer' },
    'different',
  );
  assert.ok(errors.email && errors.password && errors.display_name && errors.confirmation);
  assert.doesNotMatch(JSON.stringify(errors), /secret|different|invalid/);
});

test('Unicode password limits count characters like the backend, not UTF-16 units', () => {
  const data: Registration = {
    email: 'buyer@example.com',
    password: '🔒'.repeat(6),
    display_name: 'Buyer',
    role: 'buyer',
  };
  assert.match(registrationErrors(data, data.password).password!, /12/);
  data.password = '🔒'.repeat(12);
  assert.deepEqual(registrationErrors(data, data.password), {});
  assert.equal(validateCredentials({ email: data.email, password: '🔒'.repeat(128) }), null);
  assert.ok(credentialErrors({ email: data.email, password: '🔒'.repeat(129) }).password);
});

test('Unicode name limits and registration roles match the allowed server contract', () => {
  const data: Registration = {
    email: 'buyer@example.com',
    password: 'long-password-123',
    display_name: '🌱'.repeat(80),
    role: 'broker',
  };
  assert.deepEqual(registrationErrors(data, data.password), {});
  assert.ok(
    registrationErrors({ ...data, display_name: '🌱'.repeat(81) }, data.password).display_name,
  );
  assert.ok(
    registrationErrors({ ...data, role: 'admin' } as unknown as Registration, data.password).role,
  );
});

test('login accepts existing short passwords while signup still checks confirmation and minimum length', () => {
  const credentials = { email: 'buyer@example.com', password: 'x' };
  assert.deepEqual(credentialErrors(credentials), {});
  assert.ok(
    registrationErrors({ ...credentials, display_name: 'Buyer', role: 'buyer' }, 'x').password,
  );
  const password = '  twelve-or-more  ';
  const errors = registrationErrors(
    { ...credentials, password, display_name: 'Buyer', role: 'buyer' },
    password.trim(),
  );
  assert.equal(errors.password, undefined);
  assert.ok(errors.confirmation);
});
