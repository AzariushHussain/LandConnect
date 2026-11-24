import { ApiClient, ApiError, RequestOptions } from '../../api/client';
import type { SessionController } from '../auth/session';
import { isListingId, ListingRecord, ListingStatus, parseListingRecord } from '../listings/types';
import { canManage, PropertyForm, validateProperty } from './form';
import { parsePlaces, placeQuery } from '../maps/place-search';
import { Coordinate, parseAddress } from '../maps/address-lookup';
import { readCoordinate } from '../maps/geo';

export type StatusFilter = 'all' | ListingStatus;
export function parseOwnedListing(value: unknown, ownerId: string): ListingRecord {
  const listing = parseListingRecord(value);
  if (listing.owner.id !== ownerId)
    throw new ApiError(403, 'You can only manage your own properties.');
  return listing;
}

type SessionAccess = Pick<SessionController, 'access' | 'checkExpiry' | 'rejectToken'>;
export class ManagementApi {
  constructor(
    private readonly client: ApiClient,
    private readonly session: SessionAccess,
  ) {}

  private async request<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<{ value: T; ownerId: string }> {
    const access = this.session.access();
    if (!access) {
      this.session.checkExpiry();
      throw new ApiError(401, 'Please sign in again.');
    }
    if (!canManage(access.user.role))
      throw new ApiError(403, 'Only sellers and brokers can manage properties.');
    try {
      const value = await this.client.request<T>(path, { ...options, token: access.token });
      if (this.session.access()?.token !== access.token)
        throw new ApiError(401, 'Your session changed. Please try again.');
      return { value, ownerId: access.user.id };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401)
        await this.session.rejectToken(access.token);
      if (error instanceof ApiError && error.status === 404)
        throw new ApiError(404, 'This property or photo is no longer available to your account.');
      throw error;
    }
  }

  private id(id: string) {
    if (!isListingId(id)) throw new ApiError(404, 'Invalid property link.');
    return id;
  }

  async searchPlaces(query: string) {
    const { value } = await this.request<unknown>('/locations/search', {
      body: { q: placeQuery(query) },
    });
    return parsePlaces(value);
  }

  async reverseLocation(point: Coordinate) {
    const coordinates = readCoordinate(point.latitude, point.longitude);
    if (!coordinates) throw new Error('Choose a valid location before looking up its address.');
    const { value } = await this.request<unknown>('/locations/reverse', {
      body: { longitude: coordinates[0], latitude: coordinates[1] },
    });
    return parseAddress(value);
  }

  async mine(status: StatusFilter, offset: number, limit = 20) {
    if (
      !['all', 'draft', 'active', 'sold', 'archived'].includes(status) ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 10000 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error('Invalid property page.');
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (status !== 'all') query.set('status', status);
    const { value, ownerId } = await this.request<{
      items: unknown[];
      total: number;
      limit: number;
      offset: number;
    }>(`/listings/mine?${query}`);
    if (
      !value ||
      !Array.isArray(value.items) ||
      value.items.length > limit ||
      value.limit !== limit ||
      value.offset !== offset ||
      !Number.isSafeInteger(value.total) ||
      value.total < 0
    )
      throw new Error('Invalid property list. Please refresh.');
    return {
      items: value.items.map((item) => parseOwnedListing(item, ownerId)),
      total: value.total,
      limit,
      offset,
    };
  }

  async detail(id: string) {
    const { value, ownerId } = await this.request<unknown>(`/listings/${this.id(id)}`);
    const listing = parseOwnedListing(value, ownerId);
    if (listing.id.toLowerCase() !== id.toLowerCase())
      throw new Error('The service returned the wrong property.');
    return listing;
  }

  private async mutation<T>(name: string, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) throw error;
      // No server idempotency key exists for listing/photo creation. Never retry uncertain writes automatically.
      throw new Error(
        `Could not confirm ${name}. It may have succeeded. Refresh My properties or this property before retrying.`,
      );
    }
  }

  async create(form: PropertyForm) {
    const body = { ...validateProperty(form), status: 'draft' };
    return this.mutation('saving the draft', async () => {
      const { value, ownerId } = await this.request<unknown>('/listings', { body });
      return parseOwnedListing(value, ownerId);
    });
  }

  async save(id: string, form: PropertyForm, status?: ListingStatus) {
    if (status !== undefined) this.status(status);
    const body = { ...validateProperty(form), ...(status ? { status } : {}) };
    return this.change(id, body);
  }

  private status(status: ListingStatus) {
    if (!['draft', 'active', 'sold', 'archived'].includes(status))
      throw new Error('Invalid property status.');
  }
  async changeStatus(id: string, status: ListingStatus) {
    this.status(status);
    return this.change(id, { status });
  }
  private async change(id: string, body: object) {
    const path = `/listings/${this.id(id)}`;
    return this.mutation('updating the property', async () => {
      const { value, ownerId } = await this.request<unknown>(path, { method: 'PATCH', body });
      const listing = parseOwnedListing(value, ownerId);
      if (listing.id.toLowerCase() !== id.toLowerCase()) throw new Error('Mismatched property.');
      return listing;
    });
  }

  async archive(id: string) {
    const path = `/listings/${this.id(id)}`;
    await this.mutation('archiving the property', () =>
      this.request<void>(path, { method: 'DELETE' }),
    );
  }

  async upload(id: string, form: FormData) {
    const path = `/listings/${this.id(id)}/images`;
    return this.mutation('uploading the photo', async () => {
      const { value } = await this.request<ListingRecord['images'][number]>(path, { form });
      if (
        !value ||
        !isListingId(value.id) ||
        value.listing_id !== id ||
        value.url !== `${path}/${value.id}` ||
        !Number.isFinite(Date.parse(value.created_at))
      )
        throw new Error('Invalid photo response.');
      return {
        id: value.id,
        listing_id: value.listing_id,
        url: value.url,
        created_at: value.created_at,
      };
    });
  }

  async removePhoto(id: string, photoId: string) {
    this.id(photoId);
    const path = `/listings/${this.id(id)}/images/${photoId}`;
    await this.mutation('removing the photo', () => this.request<void>(path, { method: 'DELETE' }));
  }
}
