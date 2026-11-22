import { ApiClient } from '../../api/client';
import { emptyFilters, ListingFilters, listingQuery, normalizeFilters } from '../listings/filters';
import { isListingId } from '../listings/types';
import { Bounds, validateBounds } from './geo';

export const MAP_LIMIT = 100;
export type MapPoint = {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { title: string; price: string; currency: string; area_sq_m: string; city: string };
};
export type MapPage = {
  type: 'FeatureCollection';
  features: MapPoint[];
  total: number;
  limit: number;
  offset: number;
};
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const amount = (value: unknown) =>
  typeof value === 'string' && /^\d{1,12}(?:\.\d{1,2})?$/.test(value) && /[1-9]/.test(value);
const text = (value: unknown, max: number) =>
  typeof value === 'string' && !!value.trim() && value.length <= max;

export function parseMapPoint(value: unknown): MapPoint {
  const row = record(value),
    geometry = record(row.geometry),
    props = record(row.properties);
  const coordinates = geometry.coordinates;
  if (
    row.type !== 'Feature' ||
    typeof row.id !== 'string' ||
    !isListingId(row.id) ||
    geometry.type !== 'Point' ||
    !Array.isArray(coordinates) ||
    coordinates.length !== 2 ||
    !coordinates.every((v) => typeof v === 'number' && Number.isFinite(v)) ||
    Math.abs(coordinates[0]) > 180 ||
    Math.abs(coordinates[1]) > 90 ||
    !text(props.title, 150) ||
    !text(props.city, 100) ||
    !amount(props.price) ||
    !amount(props.area_sq_m) ||
    typeof props.currency !== 'string' ||
    !/^[A-Z]{3}$/.test(props.currency)
  )
    throw new Error('The service returned invalid map properties. Please search again.');
  return {
    type: 'Feature',
    id: row.id,
    geometry: { type: 'Point', coordinates: [coordinates[0], coordinates[1]] },
    properties: {
      title: props.title as string,
      city: props.city as string,
      price: props.price as string,
      currency: props.currency,
      area_sq_m: props.area_sq_m as string,
    },
  };
}
export function parseMapPage(value: unknown): MapPage {
  const page = record(value);
  if (
    page.type !== 'FeatureCollection' ||
    !Array.isArray(page.features) ||
    page.features.length > MAP_LIMIT ||
    page.limit !== MAP_LIMIT ||
    page.offset !== 0 ||
    !Number.isSafeInteger(page.total) ||
    (page.total as number) < page.features.length
  )
    throw new Error('The service returned an invalid map page. Please search again.');
  const features = page.features.map(parseMapPoint);
  if (new Set(features.map((point) => point.id)).size !== features.length)
    throw new Error('The service returned duplicate map properties. Please search again.');
  return {
    type: 'FeatureCollection',
    features,
    total: page.total as number,
    offset: 0,
    limit: MAP_LIMIT,
  };
}

export function routeFilters(raw?: string): ListingFilters {
  if (!raw) return { ...emptyFilters };
  if (raw.length > 3000)
    throw new Error('Invalid map search link. Open the map from the community.');
  let value: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('Invalid map filters.');
    value = record(parsed);
  } catch {
    throw new Error('Invalid map search link. Open the map from the community.');
  }
  if (
    Object.keys(value).some((key) => !Object.hasOwn(emptyFilters, key)) ||
    Object.values(value).some((v) => typeof v !== 'string')
  )
    throw new Error('Invalid map search link. Open the map from the community.');
  return normalizeFilters({ ...emptyFilters, ...value } as ListingFilters);
}
export class MapsApi {
  constructor(private readonly client: ApiClient) {}
  async search(filters: ListingFilters, bounds: Bounds) {
    const area = validateBounds(bounds);
    const query = new URLSearchParams(listingQuery(filters, 0, MAP_LIMIT));
    for (const key of ['west', 'south', 'east', 'north'] as const)
      query.set(key, String(area[key]));
    return parseMapPage(await this.client.request<unknown>(`/listings/map?${query}`));
  }
}
