export type ListingStatus = 'draft' | 'active' | 'sold' | 'archived';
export type ListingRecord = {
  id: string;
  title: string;
  description: string;
  price: string;
  currency: string;
  area_sq_m: string;
  address: string;
  city: string;
  state: string;
  country: string;
  latitude: string;
  longitude: string;
  status: ListingStatus;
  created_at: string;
  updated_at: string;
  owner: { id: string; display_name: string; role: 'buyer' | 'seller' | 'broker' };
  images: { id: string; listing_id: string; url: string; created_at: string }[];
};

export type Listing = ListingRecord & { status: 'active' };
export type ListingPage<T extends ListingRecord = Listing> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};
export const isListingId = (value: string) =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const amount = (value: unknown) =>
  typeof value === 'string' && /^\d{1,12}(?:\.\d{1,2})?$/.test(value) && /[1-9]/.test(value);
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export function parseListingRecord(value: unknown): ListingRecord {
  const row = record(value);
  const owner = record(row.owner);
  const coordinate = (value: unknown, bound: number) =>
    typeof value === 'string' &&
    /^-?\d{1,3}(?:\.\d{1,6})?$/.test(value) &&
    Math.abs(Number(value)) <= bound;
  const valid =
    typeof row.id === 'string' &&
    isListingId(row.id) &&
    ['draft', 'active', 'sold', 'archived'].includes(String(row.status)) &&
    text(row.title, 150) &&
    text(row.description, 10000) &&
    amount(row.price) &&
    amount(row.area_sq_m) &&
    typeof row.currency === 'string' &&
    /^[A-Z]{3}$/.test(row.currency) &&
    typeof row.country === 'string' &&
    /^[A-Z]{2}$/.test(row.country) &&
    text(row.address, 300) &&
    text(row.city, 100) &&
    text(row.state, 100) &&
    coordinate(row.latitude, 90) &&
    coordinate(row.longitude, 180) &&
    typeof row.created_at === 'string' &&
    Number.isFinite(Date.parse(row.created_at)) &&
    typeof row.updated_at === 'string' &&
    Number.isFinite(Date.parse(row.updated_at)) &&
    typeof owner.id === 'string' &&
    isListingId(owner.id) &&
    text(owner.display_name, 80) &&
    ['buyer', 'seller', 'broker'].includes(String(owner.role)) &&
    Array.isArray(row.images) &&
    row.images.length <= 10 &&
    row.images.every((value) => {
      const photo = record(value);
      return (
        typeof photo.id === 'string' &&
        isListingId(photo.id) &&
        photo.listing_id === row.id &&
        photo.url === `/listings/${row.id}/images/${photo.id}` &&
        typeof photo.created_at === 'string' &&
        Number.isFinite(Date.parse(photo.created_at))
      );
    });
  if (!valid) throw new Error('The service returned invalid property details. Please retry.');
  // Pick the public fields explicitly; never carry unexpected owner contact fields into UI state.
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    price: row.price,
    currency: row.currency,
    area_sq_m: row.area_sq_m,
    address: row.address,
    city: row.city,
    state: row.state,
    country: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    owner: { id: owner.id, display_name: owner.display_name, role: owner.role },
    images: (row.images as Listing['images']).map((image) => ({
      id: image.id,
      listing_id: image.listing_id,
      url: image.url,
      created_at: image.created_at,
    })),
  } as ListingRecord;
}

export function parseListing(value: unknown): Listing {
  const listing = parseListingRecord(value);
  if (listing.status !== 'active')
    throw new Error('The service returned invalid property details. Please retry.');
  return listing as Listing;
}

export function parsePage(value: unknown, offset: number, limit: number): ListingPage {
  const page = record(value);
  if (
    !Array.isArray(page.items) ||
    page.items.length > limit ||
    page.offset !== offset ||
    page.limit !== limit ||
    !Number.isSafeInteger(page.total) ||
    (page.total as number) < 0
  ) {
    throw new Error('The service returned an invalid property list. Please retry.');
  }
  return { items: page.items.map(parseListing), total: page.total as number, limit, offset };
}
