export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export function resizePhoto(
  width: number,
  height: number,
): { width: number } | { height: number } | null {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > 50_000_000
  )
    throw new Error('Choose a still photo with valid dimensions, up to 50 megapixels.');
  return Math.max(width, height) > 2048
    ? width >= height
      ? { width: 2048 }
      : { height: 2048 }
    : null;
}
export function validatePreparedPhoto(size: number, width: number, height: number) {
  if (
    !Number.isFinite(size) ||
    size <= 0 ||
    size > MAX_PHOTO_BYTES ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    Math.max(width, height) > 2048
  )
    throw new Error(
      'Could not prepare a photo under 5 MiB and 2048 pixels per side. Choose another photo.',
    );
}
