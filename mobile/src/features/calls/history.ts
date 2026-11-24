import type { Person } from '../chat/types';
import type { CallKind, CallStatus } from './api';

export type HistoryItem = {
  id: string;
  source: 'direct' | 'group';
  title: string;
  kind: CallKind;
  status: CallStatus | 'open';
  direction: 'incoming' | 'outgoing';
  created_at: string;
  conversation_id: string | null;
  peer: Person | null;
};
export type HistoryPage = { items: HistoryItem[]; hasMore: boolean };
export class CallHistory {
  private state: {
    items: HistoryItem[];
    status: 'loading' | 'ready' | 'refreshing' | 'more' | 'error';
    missed: boolean;
    hasMore: boolean;
    offset: number;
    error: string;
  } = { items: [], status: 'loading', missed: false, hasMore: false, offset: 0, error: '' };
  private generation = 0;
  private listeners = new Set<() => void>();
  constructor(
    private readonly api: { history(offset: number, missed: boolean): Promise<HistoryPage> },
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  stop = () => {
    this.generation++;
  };
  revoke(conversationId: string) {
    this.generation++;
    this.update({
      ...this.state,
      items: this.state.items.filter((item) => item.conversation_id !== conversationId),
      hasMore: false,
      status: 'ready',
    });
  }
  private update(next: typeof this.state) {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
  refresh = async () => this.load(false);
  async filter(missed: boolean) {
    this.update({ ...this.state, missed, items: [], offset: 0, hasMore: false });
    await this.load(false);
  }
  async more() {
    if (this.state.status !== 'ready' || !this.state.hasMore) return;
    await this.load(true);
  }
  private async load(append: boolean) {
    const request = ++this.generation,
      offset = append ? this.state.offset : 0,
      missed = this.state.missed;
    this.update({
      ...this.state,
      status: append ? 'more' : this.state.items.length ? 'refreshing' : 'loading',
      error: '',
    });
    try {
      const page = await this.api.history(offset, missed);
      if (request !== this.generation) return;
      // shortcut: offsets can shift as calls arrive; refresh reconciles until cursor paging is needed.
      this.update({
        ...this.state,
        items: [
          ...new Map(
            [...(append ? this.state.items : []), ...page.items].map((item) => [
              `${item.source}:${item.id}`,
              item,
            ]),
          ).values(),
        ],
        status: 'ready',
        offset: offset + page.items.length,
        hasMore: page.hasMore && offset + page.items.length <= 10000,
        error: '',
      });
    } catch (failure) {
      if (request !== this.generation) return;
      this.update({
        ...this.state,
        items: [],
        hasMore: false,
        status: 'error',
        error: failure instanceof Error ? failure.message : 'Could not load call history.',
      });
    }
  }
}

export function historyLabel(item: HistoryItem) {
  if (item.source === 'group')
    return item.status === 'open' ? 'Group call · Ongoing' : 'Group call · Ended';
  const status = {
    missed: 'Missed',
    rejected: 'Declined',
    cancelled: 'Cancelled',
    ended: 'Ended',
    ringing: 'Ringing',
    accepted: 'Ongoing',
  }[item.status as CallStatus];
  return `${item.direction === 'incoming' ? 'Incoming' : 'Outgoing'} · ${status}`;
}
