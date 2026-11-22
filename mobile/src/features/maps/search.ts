import { ListingFilters, normalizeFilters } from '../listings/filters';
import { MapPage, MapPoint, MapsApi } from './api';
import { Bounds, sameBounds, validateBounds } from './geo';

type MapState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  viewport: Bounds | null;
  searched: Bounds | null;
  features: MapPoint[];
  total: number;
  error: string;
};
export class MapSearch {
  private state: MapState = {
    status: 'idle',
    viewport: null,
    searched: null,
    features: [],
    total: 0,
    error: '',
  };
  private generation = 0;
  private listeners = new Set<() => void>();
  readonly filters: ListingFilters;
  constructor(
    private readonly api: Pick<MapsApi, 'search'>,
    filters: ListingFilters,
  ) {
    this.filters = normalizeFilters(filters);
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  invalidate = () => {
    this.generation++;
    if (this.state.status === 'loading') this.update({ ...this.state, status: 'idle' });
  };
  private update(state: MapState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  viewport(bounds: Bounds) {
    const viewport = validateBounds(bounds);
    if (!sameBounds(viewport, this.state.viewport)) this.update({ ...this.state, viewport });
  }
  async search() {
    if (!this.state.viewport) return;
    const bounds = { ...this.state.viewport };
    if (this.state.status === 'loading' && sameBounds(bounds, this.state.searched)) return;
    const generation = ++this.generation;
    this.update({
      ...this.state,
      searched: bounds,
      status: 'loading',
      features: [],
      total: 0,
      error: '',
    });
    try {
      const page: MapPage = await this.api.search(this.filters, bounds);
      if (generation !== this.generation) return;
      this.update({ ...this.state, status: 'ready', features: page.features, total: page.total });
    } catch (failure) {
      if (generation !== this.generation) return;
      this.update({
        ...this.state,
        status: 'error',
        error:
          failure instanceof Error
            ? failure.message
            : 'Could not load map properties. Search again.',
      });
    }
  }
}
