import type { ListingRecord } from '../listings/types';

export type PendingPhoto = { uri: string; body: FormData; cleanup: () => void };
type Upload = (id: string, body: FormData) => Promise<ListingRecord['images'][number]>;

export class PhotoQueue {
  private state: { items: PendingPhoto[]; blocked: boolean } = { items: [], blocked: false };
  private listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(next: typeof this.state) {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
  add(photo: PendingPhoto, savedCount: number) {
    if (this.state.items.some((item) => item.uri === photo.uri)) return;
    if (this.state.blocked || savedCount + this.state.items.length >= 10) {
      photo.cleanup();
      throw new Error(
        this.state.blocked
          ? 'Refresh saved photos before adding more.'
          : 'A property can have at most 10 photos.',
      );
    }
    this.update({ ...this.state, items: [...this.state.items, photo] });
  }
  remove(uri: string) {
    const photo = this.state.items.find((item) => item.uri === uri);
    if (!photo) return;
    this.update({ ...this.state, items: this.state.items.filter((item) => item !== photo) });
    photo.cleanup();
  }
  reconciled() {
    this.update({ ...this.state, blocked: false });
  }
  dispose() {
    for (const photo of [...this.state.items]) this.remove(photo.uri);
  }
  async upload(
    listing: ListingRecord,
    upload: Upload,
    active: () => boolean,
    saved: (value: ListingRecord) => void,
  ) {
    if (this.state.blocked) throw new Error('Refresh saved photos before saving again.');
    let current = listing;
    for (const photo of [...this.state.items]) {
      if (!active()) return null;
      if (current.images.length >= 10)
        throw new Error(
          'The saved property already has 10 photos. Remove a pending photo or review the saved photos.',
        );
      try {
        const image = await upload(current.id, photo.body);
        this.remove(photo.uri);
        if (!active()) return null;
        current = { ...current, images: [...current.images, image] };
        saved(current);
      } catch (failure) {
        this.remove(photo.uri);
        if (!active()) return null;
        this.update({ ...this.state, blocked: true });
        throw new Error(
          `Property details were saved, but a photo could not be confirmed. Refresh saved photos before adding it again. ${failure instanceof Error ? failure.message : ''}`,
        );
      }
    }
    return current;
  }
}
