import { Listing, ListingPage } from '../../src/features/listings/types';

export const listingId = (number: number) =>
  `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
export function listing(number = 1): Listing {
  const id = listingId(number);
  const image = listingId(number + 100);
  return {
    id,
    title: `Land ${number}`,
    description: 'Road access and an open plot.',
    price: '1234567.89',
    currency: 'INR',
    area_sq_m: '500.00',
    address: 'Test road',
    city: 'Pune',
    state: 'Maharashtra',
    country: 'IN',
    latitude: '18.520400',
    longitude: '73.856700',
    status: 'active',
    created_at: '2026-11-22T00:00:00Z',
    updated_at: '2026-11-22T00:00:00Z',
    owner: { id: listingId(999), display_name: 'Test seller', role: 'seller' },
    images: [
      {
        id: image,
        listing_id: id,
        url: `/listings/${id}/images/${image}`,
        created_at: '2026-11-22T00:00:00Z',
      },
    ],
  };
}

export const page = (items: Listing[], total: number, offset = 0): ListingPage => ({
  items,
  total,
  offset,
  limit: 20,
});
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
