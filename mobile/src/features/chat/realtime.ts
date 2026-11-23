import type { ChatSession } from './api';
import { messageId, row, uuid } from './types';
export type CallHint =
  | { type: 'reconcile' }
  | {
      type:
        | 'call.incoming'
        | 'call.accepted'
        | 'call.rejected'
        | 'call.cancelled'
        | 'call.missed'
        | 'call.ended';
      event_id: string;
      call_id: string;
    };
export type ChatHint =
  | { type: 'reconcile' }
  | {
      type: 'message.created' | 'conversation.updated' | 'membership.removed';
      event_id: string;
      conversation_id: string;
      actor_id: string;
      message_id?: number;
      target_user_id?: string;
    };
export type Socket = Pick<
  WebSocket,
  'onopen' | 'onmessage' | 'onclose' | 'onerror' | 'send' | 'close'
>;
export function socketUrl(base: string) {
  const url = new URL(base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws/chat';
  url.search = '';
  url.hash = '';
  return url.toString();
}
export class ChatRealtime {
  private state: { status: 'offline' | 'connecting' | 'ready' | 'retrying' | 'paused' } = {
    status: 'offline',
  };
  private listeners = new Set<() => void>();
  private hints = new Set<(hint: ChatHint) => void>();
  private callHints = new Set<(hint: CallHint) => void>();
  private socket: Socket | null = null;
  private generation = 0;
  private running = false;
  private retries = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setTimeout>;
  private seen = new Set<string>();
  constructor(
    private readonly base: string,
    private readonly session: ChatSession,
    private readonly factory: (url: string) => Socket,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  onHint = (listener: (hint: ChatHint) => void) => {
    this.hints.add(listener);
    return () => {
      this.hints.delete(listener);
    };
  };
  onCallHint = (listener: (hint: CallHint) => void) => {
    this.callHints.add(listener);
    return () => {
      this.callHints.delete(listener);
    };
  };
  private duplicate(id: string) {
    if (this.seen.has(id)) return true;
    this.seen.add(id);
    if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value!);
    return false;
  }
  private update(status: typeof this.state.status) {
    this.state = { status };
    for (const listener of this.listeners) listener();
  }
  private emit(hint: ChatHint) {
    for (const listener of this.hints) listener(hint);
  }
  start = () => {
    if (this.running) return;
    this.running = true;
    this.retries = 0;
    this.connect();
  };
  stop = () => {
    this.running = false;
    this.generation++;
    clearTimeout(this.timer);
    clearTimeout(this.watchdog);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.seen.clear();
    this.update('offline');
  };
  reconnect = () => {
    this.stop();
    this.start();
  };
  private connect() {
    const access = this.session.access();
    if (!this.running || !access) {
      this.session.checkExpiry();
      this.stop();
      return;
    }
    const generation = ++this.generation;
    this.update('connecting');
    let socket: Socket;
    const current = () =>
      this.running &&
      generation === this.generation &&
      this.session.access()?.token === access.token;
    const fail = (paused = false) => {
      if (!current()) return;
      this.generation++;
      clearTimeout(this.watchdog);
      this.socket = null;
      socket?.close();
      if (paused) {
        this.running = false;
        this.session.checkExpiry();
        this.update('paused');
        return;
      }
      this.update('retrying');
      const delay = Math.min(30000, 1000 * 2 ** Math.min(this.retries++, 5));
      this.timer = setTimeout(() => this.connect(), delay);
    };
    const watch = (ms: number) => {
      clearTimeout(this.watchdog);
      this.watchdog = setTimeout(() => fail(), ms);
    };
    try {
      socket = this.factory(socketUrl(this.base));
      this.socket = socket;
    } catch {
      fail();
      return;
    }
    watch(10000);
    socket.onopen = () => {
      if (!current()) return;
      try {
        socket.send(JSON.stringify({ type: 'auth', token: access.token }));
        watch(8000);
      } catch {
        fail();
      }
    };
    socket.onerror = () => fail();
    socket.onclose = (event) => fail(event.code === 1008 || event.code === 1009);
    socket.onmessage = (event) => {
      if (!current()) return;
      try {
        if (typeof event.data !== 'string' || event.data.length > 32768) {
          fail(true);
          return;
        }
        const data = row(JSON.parse(event.data));
        if (data.type === 'ready') {
          if (data.user_id !== access.user.id || this.state.status !== 'connecting') {
            fail(true);
            return;
          }
          this.retries = 0;
          this.update('ready');
          watch(45000);
          this.emit({ type: 'reconcile' });
          for (const listener of this.callHints) listener({ type: 'reconcile' });
          return;
        }
        if (this.state.status !== 'ready') {
          fail(true);
          return;
        }
        watch(45000);
        if (data.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        if (typeof data.type === 'string' && data.type.startsWith('meeting.')) return;
        if (typeof data.type === 'string' && data.type.startsWith('call.')) {
          if (
            ![
              'call.incoming',
              'call.accepted',
              'call.rejected',
              'call.cancelled',
              'call.missed',
              'call.ended',
            ].includes(data.type) ||
            typeof data.event_id !== 'string' ||
            !uuid(data.event_id) ||
            typeof data.call_id !== 'string' ||
            !uuid(data.call_id) ||
            (data.actor_id != null && (typeof data.actor_id !== 'string' || !uuid(data.actor_id)))
          ) {
            fail(true);
            return;
          }
          if (this.duplicate(data.event_id)) return;
          for (const listener of this.callHints)
            listener({
              type: data.type as Exclude<CallHint, { type: 'reconcile' }>['type'],
              event_id: data.event_id,
              call_id: data.call_id,
            });
          return;
        }
        if (
          !['message.created', 'conversation.updated', 'membership.removed'].includes(
            String(data.type),
          ) ||
          typeof data.event_id !== 'string' ||
          !uuid(data.event_id) ||
          typeof data.conversation_id !== 'string' ||
          !uuid(data.conversation_id) ||
          typeof data.actor_id !== 'string' ||
          !uuid(data.actor_id) ||
          (data.type === 'message.created' && !messageId(data.message_id)) ||
          (data.target_user_id !== undefined &&
            (typeof data.target_user_id !== 'string' || !uuid(data.target_user_id)))
        ) {
          fail(true);
          return;
        }
        if (this.duplicate(data.event_id)) return;
        this.emit({
          type: data.type as 'message.created' | 'conversation.updated' | 'membership.removed',
          event_id: data.event_id,
          conversation_id: data.conversation_id,
          actor_id: data.actor_id,
          ...(messageId(data.message_id) ? { message_id: data.message_id } : {}),
          ...(typeof data.target_user_id === 'string'
            ? { target_user_id: data.target_user_id }
            : {}),
        });
      } catch {
        fail(true);
      }
    };
  }
}
