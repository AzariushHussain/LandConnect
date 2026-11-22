import { ApiClient, ApiError } from '../../api/client';
import { ListingFilters, listingQuery } from './filters';
import { isListingId, parseListing, parsePage } from './types';

export class ListingsApi {
  constructor(private readonly client: ApiClient) {}

  async page(filters: ListingFilters, offset: number, limit = 20) {
    const data = await this.client.request<unknown>(
      `/listings?${listingQuery(filters, offset, limit)}`,
    );
    return parsePage(data, offset, limit);
  }

  async detail(id: string) {
    if (!isListingId(id)) throw new ApiError(404, 'This property is no longer available.');
    try {
      const listing = parseListing(await this.client.request<unknown>(`/listings/${id}`));
      if (listing.id.toLowerCase() !== id.toLowerCase())
        throw new Error('The service returned the wrong property. Please retry.');
      return listing;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404)
        throw new ApiError(404, 'This property is no longer available.');
      throw error;
    }
  }

  photoUrl(path: string): string {
    // Public listing images must stay on the configured API, never an arbitrary remote origin.
    const parts = path.split('/');
    if (
      parts.length !== 5 ||
      parts[0] !== '' ||
      parts[1] !== 'listings' ||
      parts[3] !== 'images' ||
      !isListingId(parts[2] ?? '') ||
      !isListingId(parts[4] ?? '')
    )
      throw new Error('Invalid property photo path.');
    return this.client.baseUrl + path;
  }
}
