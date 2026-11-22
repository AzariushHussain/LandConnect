export type LngLat = [number, number];
export type Bounds = { west: number; south: number; east: number; north: number };
export const INDIA_CENTER: LngLat = [78.9629, 22.5937];
export const MERCATOR_LATITUDE = 85.051129;
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const wrap = (value: number) => ((((value + 180) % 360) + 360) % 360) - 180;
const rounded = (value: number) => Number(value.toFixed(6));

export function validateBounds(bounds: Bounds): Bounds {
  if (
    !bounds ||
    ![bounds.west, bounds.south, bounds.east, bounds.north].every(finite) ||
    Math.abs(bounds.west) > 180 ||
    Math.abs(bounds.east) > 180 ||
    Math.abs(bounds.south) > 90 ||
    Math.abs(bounds.north) > 90 ||
    bounds.south > bounds.north
  )
    throw new Error('Could not read this map area. Move the map and try again.');
  return { west: bounds.west, south: bounds.south, east: bounds.east, north: bounds.north };
}

// Native cameras may wrap past +/-180; the API represents date-line crossing as west > east.
export function nativeBounds(value: unknown): Bounds {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(finite))
    throw new Error('Invalid map bounds.');
  const [west, south, east, north] = value as [number, number, number, number];
  const world = Math.abs(east - west) >= 360;
  return validateBounds({
    west: world ? -180 : rounded(wrap(west)),
    south: rounded(south),
    east: world ? 180 : rounded(wrap(east)),
    north: rounded(north),
  });
}
export const sameBounds = (a: Bounds | null, b: Bounds | null) =>
  !!a &&
  !!b &&
  a.west === b.west &&
  a.south === b.south &&
  a.east === b.east &&
  a.north === b.north;

export function readCoordinate(latitude: string, longitude: string): LngLat | null {
  if (
    !/^-?\d{1,3}(?:\.\d{1,6})?$/.test(latitude.trim()) ||
    !/^-?\d{1,3}(?:\.\d{1,6})?$/.test(longitude.trim())
  )
    return null;
  const lat = Number(latitude),
    lng = Number(longitude);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lng, lat] : null;
}
export function pickedCoordinate(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every(finite) ||
    Math.abs(value[1]!) > 90
  )
    throw new Error('Choose a valid location on the map.');
  const [longitude, latitude] = value as LngLat;
  return { longitude: rounded(wrap(longitude)).toFixed(6), latitude: rounded(latitude).toFixed(6) };
}
export const cameraCenter = ([lng, lat]: LngLat): LngLat => [
  lng,
  Math.max(-MERCATOR_LATITUDE, Math.min(MERCATOR_LATITUDE, lat)),
];
