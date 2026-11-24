import type { ListingRecord } from '../listings/types';
import type { ManagementApi } from './api';
import { PropertyForm, validateProperty } from './form';
import { PhotoQueue } from './photo-queue';

export async function saveProperty({
  form,
  record,
  publish,
  photos,
  api,
  active,
  saved,
  progress,
}: {
  form: PropertyForm;
  record: ListingRecord | null;
  publish: boolean;
  photos: PhotoQueue;
  api: Pick<ManagementApi, 'create' | 'save' | 'upload' | 'changeStatus'>;
  active: () => boolean;
  saved: (value: ListingRecord) => void;
  progress: (value: string) => void;
}) {
  validateProperty(form);
  if (photos.getSnapshot().blocked) throw new Error('Refresh saved photos before saving again.');
  if (!active()) return null;
  progress('Saving property details…');
  let current = record ? await api.save(record.id, form) : await api.create(form);
  if (!active()) return null;
  saved(current);
  if (photos.getSnapshot().items.length) progress('Uploading selected photos…');
  const uploaded = await photos.upload(current, (id, body) => api.upload(id, body), active, saved);
  if (!uploaded || !active()) return null;
  current = uploaded;
  if (publish && current.status !== 'active') {
    progress('Publishing property…');
    current = await api.changeStatus(current.id, 'active');
    if (!active()) return null;
    saved(current);
  }
  return current;
}
