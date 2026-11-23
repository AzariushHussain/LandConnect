import type { ChatApi } from './api';
import type { Person } from './types';

type State = {
  query: string;
  items: Person[];
  loading: boolean;
  opening: string | null;
  hasMore: boolean;
  error: string;
};
const empty = (): State => ({
  query: '',
  items: [],
  loading: false,
  opening: null,
  hasMore: false,
  error: '',
});
export class RecipientSearch {
  private state = empty();
  private generation = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly api: Pick<ChatApi, 'searchPeople' | 'direct'>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  setQuery = (query: string) => {
    if (this.state.opening) return;
    this.generation++;
    this.update({ ...empty(), query, loading: Array.from(query.trim()).length >= 2 });
  };
  stop = () => {
    this.generation++;
    this.update(empty());
  };
  search = async () => {
    const query = this.state.query.trim();
    if (Array.from(query).length < 2 || this.state.opening) return;
    const generation = ++this.generation;
    this.update({ loading: true, error: '' });
    try {
      const result = await this.api.searchPeople(query);
      if (generation === this.generation) this.update({ ...result, loading: false });
    } catch (failure) {
      if (generation === this.generation)
        this.update({
          loading: false,
          items: [],
          hasMore: false,
          error: failure instanceof Error ? failure.message : 'Could not search for people.',
        });
    }
  };
  open = async (id: string) => {
    if (this.state.opening || !this.state.items.some((person) => person.id === id)) return null;
    const generation = this.generation;
    this.update({ opening: id, error: '' });
    try {
      const chat = await this.api.direct(id);
      return generation === this.generation ? chat : null;
    } catch (failure) {
      if (generation === this.generation)
        this.update({ error: failure instanceof Error ? failure.message : 'Could not open chat.' });
      return null;
    } finally {
      if (generation === this.generation) this.update({ opening: null });
    }
  };
}
