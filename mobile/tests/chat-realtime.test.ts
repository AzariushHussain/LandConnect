import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatRealtime, Socket, socketUrl } from '../src/features/chat/realtime';
import { actor, chatId, person } from './fixtures/chat';
import { listingId } from './fixtures/listings';

class FakeSocket implements Socket {
  onopen: Socket['onopen'] = null;
  onmessage: Socket['onmessage'] = null;
  onclose: Socket['onclose'] = null;
  onerror: Socket['onerror'] = null;
  sent: string[] = [];
  closed = 0;
  send(data: Parameters<Socket['send']>[0]) {
    this.sent.push(String(data));
  }
  close() {
    this.closed++;
  }
  open() {
    this.onopen?.call(this as unknown as WebSocket, new Event('open'));
  }
  receive(data: unknown) {
    this.onmessage?.call(
      this as unknown as WebSocket,
      { data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent,
    );
  }
  disconnect(code: number) {
    this.onclose?.call(this as unknown as WebSocket, { code } as CloseEvent);
  }
}
function fixture() {
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const transport = new ChatRealtime(
    'https://api.example.com',
    {
      access: () => ({
        token: 'private-token',
        user: {
          ...person(),
          email: 'private',
          allow_calls: true,
          allow_messages: true,
          created_at: '2026-11-23T00:00:00Z',
        },
      }),
      checkExpiry: () => {},
      rejectToken: async () => {},
    },
    (url) => {
      urls.push(url);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  );
  transport.start();
  return { transport, sockets, urls };
}
const hint = (n = 1) => ({
  type: 'message.created',
  event_id: listingId(n),
  conversation_id: chatId,
  actor_id: actor,
  message_id: n,
});

test('socket auth stays in the first frame, with a token-free URL and heartbeat pong', () => {
  const f = fixture();
  let reconciles = 0;
  f.transport.onHint((event) => {
    if (event.type === 'reconcile') reconciles++;
  });
  try {
    const socket = f.sockets[0]!;
    socket.open();
    assert.deepEqual(JSON.parse(socket.sent[0]!), { type: 'auth', token: 'private-token' });
    assert.equal(f.urls[0], 'wss://api.example.com/ws/chat');
    socket.receive({ type: 'ready', user_id: actor });
    socket.receive({ type: 'ping' });
    assert.deepEqual(JSON.parse(socket.sent[1]!), { type: 'pong' });
    assert.equal(reconciles, 1);
    assert.equal(f.transport.getSnapshot().status, 'ready');
    assert.equal(socketUrl('http://192.168.1.2:8000'), 'ws://192.168.1.2:8000/ws/chat');
  } finally {
    f.transport.stop();
  }
});
test('hints deduplicate by event ID and never forward message bodies or extra contact fields', () => {
  const f = fixture();
  const events: unknown[] = [];
  f.transport.onHint((event) => events.push(event));
  try {
    f.sockets[0]!.open();
    f.sockets[0]!.receive({ type: 'ready', user_id: actor });
    f.sockets[0]!.receive({ ...hint(), body: 'private', email: 'private' });
    f.sockets[0]!.receive(hint());
    assert.equal(events.length, 2);
    assert.equal('body' in (events[1] as object), false);
  } finally {
    f.transport.stop();
  }
});
test('transient closure retries with backoff and reconnect emits history recovery', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  let recovered = 0;
  f.transport.onHint((event) => {
    if (event.type === 'reconcile') recovered++;
  });
  try {
    f.sockets[0]!.disconnect(1013);
    assert.equal(f.transport.getSnapshot().status, 'retrying');
    context.mock.timers.tick(1000);
    assert.equal(f.sockets.length, 2);
    f.sockets[1]!.open();
    f.sockets[1]!.receive({ type: 'ready', user_id: actor });
    assert.equal(recovered, 1);
  } finally {
    f.transport.stop();
  }
});
test('malformed frames and policy rejection pause instead of reconnecting forever', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  for (const payload of ['not-json', { type: 'ready', user_id: listingId(999) }, hint()]) {
    const f = fixture();
    f.sockets[0]!.open();
    f.sockets[0]!.receive(payload);
    assert.equal(f.transport.getSnapshot().status, 'paused');
    context.mock.timers.tick(60000);
    assert.equal(f.sockets.length, 1);
    f.transport.stop();
  }
  const f = fixture();
  f.sockets[0]!.disconnect(1008);
  context.mock.timers.tick(60000);
  assert.equal(f.sockets.length, 1);
  f.transport.stop();
});
test('missing authentication/heartbeats time out and background stop cancels retry timers', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.sockets[0]!.open();
  context.mock.timers.tick(8000);
  assert.equal(f.transport.getSnapshot().status, 'retrying');
  f.transport.stop();
  context.mock.timers.tick(60000);
  assert.equal(f.sockets.length, 1);
  f.transport.start();
  f.sockets[1]!.open();
  f.sockets[1]!.receive({ type: 'ready', user_id: actor });
  context.mock.timers.tick(45000);
  assert.equal(f.transport.getSnapshot().status, 'retrying');
  f.transport.stop();
});
test('stale sockets and stopped sessions cannot deliver later hints', () => {
  const f = fixture();
  let events = 0;
  f.transport.onHint(() => events++);
  const old = f.sockets[0]!;
  old.open();
  f.transport.stop();
  old.receive({ type: 'ready', user_id: actor });
  old.receive(hint());
  assert.equal(events, 0);
  f.transport.start();
  assert.equal(f.sockets.length, 2);
  f.transport.start();
  assert.equal(f.sockets.length, 2);
  f.transport.stop();
});
test('call hints share the authenticated socket, deduplicate and forward metadata only', () => {
  const f = fixture();
  const calls: unknown[] = [],
    chats: unknown[] = [];
  f.transport.onCallHint((hint) => calls.push(hint));
  f.transport.onHint((hint) => chats.push(hint));
  try {
    f.sockets[0]!.open();
    f.sockets[0]!.receive({ type: 'ready', user_id: actor });
    const event = {
      type: 'call.incoming',
      call_id: chatId,
      event_id: listingId(500),
      actor_id: actor,
      token: 'private',
    };
    f.sockets[0]!.receive(event);
    f.sockets[0]!.receive(event);
    assert.deepEqual(calls, [
      { type: 'reconcile' },
      { type: 'call.incoming', call_id: chatId, event_id: listingId(500) },
    ]);
    assert.equal(chats.length, 1);
    assert.equal(f.sockets.length, 1);
    f.sockets[0]!.receive({ ...event, call_id: 'bad' });
    assert.equal(f.transport.getSnapshot().status, 'paused');
  } finally {
    f.transport.stop();
  }
});
