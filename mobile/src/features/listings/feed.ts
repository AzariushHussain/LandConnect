import { emptyFilters, ListingFilters, normalizeFilters } from './filters';
import { Listing, ListingRecord, ListingPage } from './types';

export type FeedState<T extends ListingRecord = Listing> = {
  status: 'loading' | 'ready' | 'refreshing' | 'loadingMore' | 'error';
  items: T[];
  filters: ListingFilters;
  total: number;
  nextOffset: number;
  hasMore: boolean;
  capped: boolean;
  error: string;
};

export class ListingFeed<T extends ListingRecord = Listing> {
  private state: FeedState<T> = {
    status: 'loading',
    items: [],
    filters: { ...emptyFilters },
    total: 0,
    nextOffset: 0,
    hasMore: false,
    capped: false,
    error: '',
  };
  private generation = 0;
  private listeners = new Set<() => void>();
  constructor(
    private readonly api: {
      page(filters: ListingFilters, offset: number, limit: number): Promise<ListingPage<T>>;
    },
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  invalidate = () => {
    this.generation++;
  };
  private update(state: FeedState<T>) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  async apply(input: ListingFilters) {
    const filters = normalizeFilters(input);
    this.update({
      ...this.state,
      filters,
      items: [],
      total: 0,
      nextOffset: 0,
      hasMore: false,
      capped: false,
      status: 'loading',
      error: '',
    });
    await this.load(false);
  }

  async refresh() {
    this.update({
      ...this.state,
      status: this.state.items.length ? 'refreshing' : 'loading',
      error: '',
    });
    await this.load(false);
  }

  async more() {
    if (this.state.status !== 'ready' || !this.state.hasMore) return;
    this.update({ ...this.state, status: 'loadingMore', error: '' });
    await this.load(true);
  }

  private async load(append: boolean) {
    const generation = ++this.generation;
    const filters = { ...this.state.filters };
    const offset = append ? this.state.nextOffset : 0;
    try {
      const page = await this.api.page(filters, offset, 20);
      if (generation !== this.generation) return;
      const nextOffset = offset + page.items.length;
      // shortcut: backend uses offsets; refresh to reconcile deletions/insertions until keyset pagination is added.
      const items = [
        ...new Map(
          [...(append ? this.state.items : []), ...page.items].map((item) => [item.id, item]),
        ).values(),
      ];
      this.update({
        ...this.state,
        items,
        total: page.total,
        nextOffset,
        hasMore: page.items.length > 0 && nextOffset < page.total && nextOffset <= 10000,
        capped: nextOffset > 10000 && nextOffset < page.total,
        status: 'ready',
        error: '',
      });
    } catch (error) {
      if (generation !== this.generation) return;
      this.update({
        ...this.state,
        status: append ? 'ready' : 'error',
        error: error instanceof Error ? error.message : 'Could not load properties. Please retry.',
      });
    }
  }
}
