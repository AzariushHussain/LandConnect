export const emptyFilters = {
  q: '',
  city: '',
  state: '',
  country: '',
  currency: '',
  min_price: '',
  max_price: '',
  min_area: '',
  max_area: '',
};
export type ListingFilters = typeof emptyFilters;

function decimal(value: string) {
  return /^\d{1,12}(?:\.\d{1,2})?$/.test(value);
}

// Compare cents as integers, preserving every digit in the API's Decimal range.
function hundredths(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function normalizeFilters(input: ListingFilters): ListingFilters {
  const filters = { ...input };
  for (const key of Object.keys(emptyFilters) as (keyof ListingFilters)[])
    filters[key] = input[key].trim();
  filters.country = filters.country.toUpperCase();
  filters.currency = filters.currency.toUpperCase();
  for (const key of ['q', 'city', 'state'] as const) {
    if (filters[key].length > 100)
      throw new Error('Search and place names can contain up to 100 characters.');
  }
  if (filters.country && !/^[A-Z]{2}$/.test(filters.country))
    throw new Error('Use a two-letter country code, such as IN.');
  if (filters.currency && !/^[A-Z]{3}$/.test(filters.currency))
    throw new Error('Use a three-letter currency code, such as INR.');
  for (const [lower, upper, label] of [
    ['min_price', 'max_price', 'price'],
    ['min_area', 'max_area', 'area'],
  ] as const) {
    for (const key of [lower, upper]) {
      if (filters[key] && !decimal(filters[key]))
        throw new Error(
          `Enter a non-negative ${label} with at most 12 whole digits and 2 decimal places.`,
        );
    }
    if (
      filters[lower] &&
      filters[upper] &&
      hundredths(filters[lower]) > hundredths(filters[upper])
    ) {
      throw new Error(`Minimum ${label} cannot exceed maximum ${label}.`);
    }
  }
  if ((filters.min_price || filters.max_price) && !filters.currency)
    throw new Error('Choose a currency when filtering by price.');
  return filters;
}

export function listingQuery(filters: ListingFilters, offset: number, limit = 20): string {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('Invalid property page size.');
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
    throw new Error('Refine your search to see more properties.');
  const normalized = normalizeFilters(filters);
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  for (const key of Object.keys(emptyFilters) as (keyof ListingFilters)[]) {
    if (normalized[key]) query.set(key, normalized[key]);
  }
  return query.toString();
}

export function formatDecimal(value: string): string {
  const [whole = '', fraction] = value.split('.');
  const tail = whole.slice(-3);
  const head = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = head ? `${head},${tail}` : tail;
  return fraction && !/^0+$/.test(fraction) ? `${grouped}.${fraction.padEnd(2, '0')}` : grouped;
}
