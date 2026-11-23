import type { PrivacyApi } from './api';
import { Person } from '../chat/types';
type State = {
  items: Person[];
  loading: boolean;
  more: boolean;
  next: number;
  hasMore: boolean;
  busy: string | null;
  error: string;
  notice: string;
};
export class BlockedAccounts {
  private state: State = {
    items: [],
    loading: true,
    more: false,
    next: 0,
    hasMore: false,
    busy: null,
    error: '',
    notice: '',
  };
  private generation = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly api: Pick<PrivacyApi, 'blocks' | 'unblock'>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(state: State) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  stop = () => {
    this.generation++;
  };
  refresh = () => this.load(false);
  more = () =>
    this.state.hasMore && !this.state.loading && !this.state.more
      ? this.load(true)
      : Promise.resolve();
  private async load(append: boolean) {
    if (this.state.busy) return;
    const generation = ++this.generation,
      offset = append ? this.state.next : 0;
    this.update({ ...this.state, loading: !append, more: append, error: '' });
    try {
      const rows = await this.api.blocks(offset);
      if (generation !== this.generation) return;
      this.update({
        ...this.state,
        items: [
          ...new Map(
            [...(append ? this.state.items : []), ...rows].map((peer) => [peer.id, peer]),
          ).values(),
        ],
        next: offset + rows.length,
        hasMore: rows.length === 20 && offset + rows.length <= 10000,
        loading: false,
        more: false,
      });
    } catch (failure) {
      if (generation === this.generation)
        this.update({
          ...this.state,
          loading: false,
          more: false,
          error: failure instanceof Error ? failure.message : 'Could not load blocked accounts.',
        });
    }
  }
  unblock = async (id: string) => {
    if (
      this.state.busy ||
      this.state.loading ||
      this.state.more ||
      !this.state.items.some((peer) => peer.id === id)
    )
      return;
    const generation = ++this.generation;
    this.update({ ...this.state, busy: id, error: '', notice: '' });
    try {
      await this.api.unblock(id);
      if (generation !== this.generation) return;
      this.update({
        ...this.state,
        items: this.state.items.filter((peer) => peer.id !== id),
        busy: null,
        hasMore: false,
        next: 0,
        notice: 'Account unblocked. Other privacy settings and blocks still apply.',
      });
      // A confirmed deletion shifts offsets; refresh independently so a read failure cannot undo success.
      void this.refresh();
    } catch (failure) {
      if (generation === this.generation)
        this.update({
          ...this.state,
          busy: null,
          error:
            failure instanceof Error
              ? `${failure.message} Refresh the list before retrying.`
              : 'Could not confirm unblocking. Refresh the list before retrying.',
        });
    }
  };
}
