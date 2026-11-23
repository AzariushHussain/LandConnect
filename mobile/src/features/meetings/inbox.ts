import { Meeting, MeetingsApi } from './api';

export class MeetingsInbox {
  private state = {
    items: [] as Meeting[],
    status: 'open' as 'open' | 'ended',
    loading: true,
    more: false,
    next: 0,
    hasMore: false,
    error: '',
  };
  private generation = 0;
  private pending = false;
  private listeners = new Set<() => void>();
  constructor(private readonly api: Pick<MeetingsApi, 'list'>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  stop = () => {
    this.generation++;
    this.pending = false;
  };
  filter = (status: 'open' | 'ended') => {
    if (status === this.state.status) return;
    this.stop();
    this.update({ status, items: [], next: 0, hasMore: false });
    void this.refresh();
  };
  refresh = () => this.load(false);
  more = () => (this.state.hasMore ? this.load(true) : Promise.resolve());
  private async load(append: boolean) {
    if (this.pending) return;
    this.pending = true;
    const generation = ++this.generation,
      offset = append ? this.state.next : 0;
    this.update({ loading: !append, more: append, error: '' });
    try {
      const rows = await this.api.list(offset, this.state.status);
      if (generation !== this.generation) return;
      this.update({
        items: [
          ...new Map([...(append ? this.state.items : []), ...rows].map((m) => [m.id, m])).values(),
        ],
        next: offset + rows.length,
        hasMore: rows.length === 20 && offset + rows.length <= 10000,
      });
    } catch (error) {
      if (generation === this.generation)
        this.update({ error: error instanceof Error ? error.message : 'Meetings unavailable.' });
    } finally {
      if (generation === this.generation) {
        this.pending = false;
        this.update({ loading: false, more: false });
      }
    }
  }
}
