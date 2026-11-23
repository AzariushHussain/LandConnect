import { ApiError } from '../../api/client';
import type { ChatApi } from './api';
import { Conversation, Message, MessagePage, validateBody } from './types';
type Attempt = { clientId: string; body: string; sending: boolean; error: string };
type ThreadState = {
  chat: Conversation | null;
  messages: Message[];
  loading: boolean;
  syncing: boolean;
  older: boolean;
  unavailable: boolean;
  before: number | null;
  after: number | null;
  moreNew: boolean;
  draft: string;
  attempt: Attempt | null;
  error: string;
};
export class Thread {
  private state: ThreadState = {
    chat: null,
    messages: [],
    loading: true,
    syncing: false,
    older: false,
    unavailable: false,
    before: null,
    after: null,
    moreNew: false,
    draft: '',
    attempt: null,
    error: '',
  };
  private generation = 0;
  private syncing = false;
  private requested = false;
  private listeners = new Set<() => void>();
  constructor(
    readonly id: string,
    readonly actor: string,
    private readonly api: Pick<ChatApi, 'detail' | 'history' | 'send'>,
    private readonly uuid: () => string,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(state: ThreadState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  stop = () => {
    this.generation++;
    this.syncing = false;
  };
  draft = (draft: string) => {
    if (!this.state.attempt) this.update({ ...this.state, draft });
  };
  discard = () => {
    if (!this.state.attempt?.sending) this.update({ ...this.state, draft: '', attempt: null });
  };
  deny = () => {
    this.generation++;
    this.update({
      ...this.state,
      chat: null,
      messages: [],
      draft: '',
      attempt: null,
      unavailable: true,
      loading: false,
      syncing: false,
      older: false,
      error: 'You no longer have access to this conversation.',
    });
  };
  private failed(failure: unknown) {
    if (failure instanceof ApiError && (failure.status === 404 || failure.status === 401))
      this.deny();
    else
      this.update({
        ...this.state,
        loading: false,
        syncing: false,
        older: false,
        error: failure instanceof Error ? failure.message : 'Could not update this chat.',
      });
  }
  private merge(items: Message[]) {
    const messages = [
      ...new Map([...this.state.messages, ...items].map((item) => [item.id, item])).values(),
    ].sort((a, b) => a.id - b.id);
    const pending = this.state.attempt;
    const confirmed =
      pending &&
      messages.some(
        (item) =>
          item.sender.id === this.actor &&
          item.client_id === pending.clientId &&
          item.body === pending.body,
      );
    this.update({ ...this.state, messages, ...(confirmed ? { attempt: null, draft: '' } : {}) });
  }
  sync = async () => {
    if (this.state.unavailable) return;
    if (this.syncing) {
      this.requested = true;
      return;
    }
    this.syncing = true;
    this.requested = false;
    const generation = this.generation;
    this.update({ ...this.state, syncing: true, error: '' });
    try {
      const chat = await this.api.detail(this.id);
      if (generation !== this.generation) return;
      this.update({ ...this.state, chat });
      let query = this.state.after === null ? {} : { after: this.state.after };
      for (let count = 0; count < 5; count++) {
        const initial = this.state.after === null;
        const page: MessagePage = await this.api.history(this.id, query);
        if (generation !== this.generation) return;
        this.merge(page.items);
        this.update({
          ...this.state,
          after: page.next_after_id ?? this.state.after ?? 0,
          before: initial ? page.next_before_id : this.state.before,
          loading: false,
          moreNew: !initial && page.has_more,
        });
        if (initial || !page.has_more) break;
        query = { after: this.state.after! };
      }
    } catch (failure) {
      if (generation === this.generation) this.failed(failure);
    } finally {
      if (generation === this.generation) {
        this.syncing = false;
        this.update({ ...this.state, syncing: false });
        if (this.requested) void this.sync();
      }
    }
  };
  older = async () => {
    if (
      this.state.older ||
      this.state.before === null ||
      this.state.unavailable ||
      this.state.loading
    )
      return;
    const generation = this.generation,
      before = this.state.before;
    this.update({ ...this.state, older: true, error: '' });
    try {
      const page = await this.api.history(this.id, { before });
      if (generation !== this.generation) return;
      this.merge(page.items);
      this.update({ ...this.state, before: page.next_before_id, older: false });
    } catch (failure) {
      if (generation === this.generation) this.failed(failure);
    }
  };
  send = async () => {
    if (this.state.unavailable || this.state.loading || this.state.attempt?.sending) return;
    try {
      if (!this.state.attempt) {
        validateBody(this.state.draft);
        this.update({
          ...this.state,
          attempt: { clientId: this.uuid(), body: this.state.draft, sending: false, error: '' },
        });
      }
    } catch (failure) {
      this.failed(failure);
      return;
    }
    const attempt = this.state.attempt!;
    const generation = this.generation;
    this.update({ ...this.state, attempt: { ...attempt, sending: true, error: '' } });
    try {
      const saved = await this.api.send(this.id, attempt.clientId, attempt.body);
      if (generation !== this.generation) return;
      this.merge([saved]);
      void this.sync();
    } catch (failure) {
      if (generation !== this.generation) return;
      if (failure instanceof ApiError && (failure.status === 404 || failure.status === 401))
        this.deny();
      else if (this.state.attempt?.clientId === attempt.clientId)
        this.update({
          ...this.state,
          attempt: {
            ...attempt,
            sending: false,
            error:
              failure instanceof ApiError
                ? failure.message
                : 'Delivery could not be confirmed. Retry this same message, or refresh history before discarding it.',
          },
        });
    }
  };
}
