import type { ChatApi } from './api';
import { Conversation, Person } from './types';
type InboxState = {
  items: Conversation[];
  loading: boolean;
  more: boolean;
  hasMore: boolean;
  next: number;
  error: string;
};
export class Inbox {
  private state: InboxState = {
    items: [],
    loading: true,
    more: false,
    hasMore: false,
    next: 0,
    error: '',
  };
  private generation = 0;
  private pending = false;
  private listeners = new Set<() => void>();
  constructor(private readonly api: Pick<ChatApi, 'list'>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(state: InboxState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  stop = () => {
    this.generation++;
    this.pending = false;
  };
  refresh = () => this.load(false);
  more = () => (this.state.hasMore ? this.load(true) : Promise.resolve());
  private async load(append: boolean) {
    if (this.pending) return;
    this.pending = true;
    const generation = ++this.generation;
    const offset = append ? this.state.next : 0;
    this.update({ ...this.state, loading: !append, more: append, error: '' });
    try {
      const rows = await this.api.list(offset);
      if (generation !== this.generation) return;
      this.update({
        items: [
          ...new Map(
            [...(append ? this.state.items : []), ...rows].map((chat) => [chat.id, chat]),
          ).values(),
        ],
        loading: false,
        more: false,
        next: offset + rows.length,
        hasMore: rows.length === 20 && offset + rows.length <= 10000,
        error: '',
      });
    } catch (failure) {
      if (generation === this.generation)
        this.update({
          ...this.state,
          loading: false,
          more: false,
          error: failure instanceof Error ? failure.message : 'Could not load conversations.',
        });
    } finally {
      if (generation === this.generation) this.pending = false;
    }
  }
}
export function people(chats: Conversation[], actor: string): Person[] {
  return [
    ...new Map(
      chats
        .flatMap((chat) => chat.members.map((member) => member.user))
        .filter((person) => person.id !== actor)
        .map((person) => [person.id, person]),
    ).values(),
  ].sort((a, b) => a.display_name.localeCompare(b.display_name));
}
