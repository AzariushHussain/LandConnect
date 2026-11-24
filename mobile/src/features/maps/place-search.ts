export type Place = {
  id: string;
  name: string;
  label: string;
  longitude: number;
  latitude: number;
};
export function placeQuery(value: string) {
  const query = value.trim().replace(/\s+/g, ' ');
  if (Array.from(query).length < 3 || Array.from(query).length > 200)
    throw new Error('Enter a place or address using 3 to 200 characters.');
  return query;
}
export function parsePlaces(value: unknown): Place[] {
  const fail = () => {
    throw new Error('Place results could not be read. Please search again.');
  };
  if (
    !value ||
    typeof value !== 'object' ||
    !('items' in value) ||
    !Array.isArray(value.items) ||
    value.items.length > 5
  )
    return fail();
  const items = value.items.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return fail();
    const item = raw as Record<string, unknown>;
    for (const [key, max] of [
      ['id', 100],
      ['name', 150],
      ['label', 500],
    ] as const)
      if (typeof item[key] !== 'string' || !item[key].trim() || Array.from(item[key]).length > max)
        return fail();
    if (
      typeof item.longitude !== 'number' ||
      !Number.isFinite(item.longitude) ||
      Math.abs(item.longitude) > 180 ||
      typeof item.latitude !== 'number' ||
      !Number.isFinite(item.latitude) ||
      Math.abs(item.latitude) > 90
    )
      return fail();
    return {
      id: item.id as string,
      name: item.name as string,
      label: item.label as string,
      longitude: item.longitude,
      latitude: item.latitude,
    };
  });
  if (new Set(items.map((place) => place.id)).size !== items.length) return fail();
  return items;
}

const empty = () => ({ query: '', items: [] as Place[], busy: false, searched: false, error: '' });
export class PlaceSearch {
  private state = empty();
  private generation = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly lookup: (query: string) => Promise<Place[]>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<ReturnType<typeof empty>>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  setQuery = (query: string) => {
    this.generation++;
    this.update({ ...empty(), query });
  };
  dismiss = () => {
    this.generation++;
    this.update({ ...empty(), query: this.state.query });
  };
  async search() {
    if (this.state.busy) return;
    const generation = ++this.generation;
    try {
      const query = placeQuery(this.state.query);
      this.update({ busy: true, searched: false, items: [], error: '' });
      const items = await this.lookup(query);
      if (generation === this.generation) this.update({ items, busy: false, searched: true });
    } catch (failure) {
      if (generation === this.generation)
        this.update({
          busy: false,
          error:
            failure instanceof Error
              ? failure.message
              : 'Place search is unavailable. Try selecting on the map.',
        });
    }
  }
}
