import { ListingRecord } from '../listings/types';

export const emptyProperty = {
  title: '',
  description: '',
  price: '',
  currency: 'INR',
  area_sq_m: '',
  address: '',
  city: '',
  state: '',
  country: 'IN',
  latitude: '',
  longitude: '',
};
export type PropertyForm = typeof emptyProperty;
export const propertyFields = [
  ['title', 'Property title', 150],
  ['description', 'Description', 10000],
  ['price', 'Price', 15],
  ['currency', 'Currency (e.g. INR)', 3],
  ['area_sq_m', 'Area in square metres', 15],
  ['address', 'Street / property address', 300],
  ['city', 'City', 100],
  ['state', 'State', 100],
  ['country', 'Country (e.g. IN)', 2],
  ['latitude', 'Latitude', 11],
  ['longitude', 'Longitude', 11],
] as const;

export const canManage = (role: string) => role === 'seller' || role === 'broker';
export function propertyForm(listing: ListingRecord): PropertyForm {
  return Object.fromEntries(propertyFields.map(([key]) => [key, listing[key]])) as PropertyForm;
}

export function validateProperty(input: PropertyForm): PropertyForm {
  const data = { ...emptyProperty };
  for (const [key, label, max] of propertyFields) {
    const value = input[key].trim();
    if (!value || value.length > max)
      throw new Error(`${label} is required and must contain at most ${max} characters.`);
    data[key] = value;
  }
  data.currency = data.currency.toUpperCase();
  data.country = data.country.toUpperCase();
  if (!/^[A-Z]{3}$/.test(data.currency)) throw new Error('Use a three-letter currency code.');
  if (!/^[A-Z]{2}$/.test(data.country)) throw new Error('Use a two-letter country code.');
  for (const key of ['price', 'area_sq_m'] as const) {
    if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(data[key]) || !/[1-9]/.test(data[key]))
      throw new Error(
        'Price and area must be positive, with at most 12 whole digits and 2 decimal places.',
      );
  }
  for (const [key, bound] of [
    ['latitude', 90],
    ['longitude', 180],
  ] as const) {
    if (!/^-?\d{1,3}(?:\.\d{1,6})?$/.test(data[key]) || Math.abs(Number(data[key])) > bound)
      throw new Error(
        `${key === 'latitude' ? 'Latitude' : 'Longitude'} must be between -${bound} and ${bound}, with at most 6 decimal places.`,
      );
  }
  return data;
}
