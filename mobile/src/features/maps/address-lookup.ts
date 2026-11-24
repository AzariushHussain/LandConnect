import { pickedCoordinate, LngLat } from './geo';

export type Coordinate = { latitude: string; longitude: string };
export type LocationAddress = Partial<{
  address: string;
  city: string;
  state: string;
  country: string;
}>;
export type SelectedLocation = { point: Coordinate; address: LocationAddress | null };
export function locationFields({ point, address }: SelectedLocation) {
  return address === null
    ? point
    : { ...point, address: '', city: '', state: '', country: '', ...address };
}
export function parseAddress(value: unknown): LocationAddress {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('The address could not be read. Please enter it manually.');
  const result: LocationAddress = {};
  for (const [key, max] of [
    ['address', 300],
    ['city', 100],
    ['state', 100],
    ['country', 2],
  ] as const) {
    const field = (value as Record<string, unknown>)[key];
    if (field === undefined || field === null) continue;
    if (
      typeof field !== 'string' ||
      !field.trim() ||
      Array.from(field).length > max ||
      (key === 'country' && !/^[A-Z]{2}$/.test(field))
    )
      throw new Error('The address could not be read. Please enter it manually.');
    result[key] = field;
  }
  return result;
}

export class AddressLookup {
  private state = { busy: false, error: '' };
  private generation = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly lookup: (point: Coordinate) => Promise<LocationAddress>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(busy: boolean, error = '') {
    this.state = { busy, error };
    this.listeners.forEach((listener) => listener());
  }
  cancel = () => {
    this.generation++;
    this.update(false);
  };
  async resolve(value: LngLat): Promise<SelectedLocation | null> {
    if (this.state.busy) return null;
    const generation = ++this.generation;
    this.update(true);
    try {
      const point = pickedCoordinate(value);
      const address = await this.lookup(point);
      return generation === this.generation ? { point, address } : null;
    } catch (failure) {
      if (generation === this.generation)
        this.update(
          false,
          failure instanceof Error
            ? failure.message
            : 'Could not look up the address. You can enter it manually.',
        );
      return null;
    } finally {
      if (generation === this.generation && this.state.busy) this.update(false);
    }
  }
}
