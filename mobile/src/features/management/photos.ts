import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat, ImageRef } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import { resizePhoto, validatePreparedPhoto } from './photo-policy';

export async function choosePropertyPhoto() {
  try {
    return await preparePhoto();
  } catch {
    throw new Error(
      'Could not prepare this photo. Select another local still image up to 50 megapixels.',
    );
  }
}

async function preparePhoto() {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 1,
    exif: false,
    base64: false,
  });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  if (
    !asset ||
    asset.type !== 'image' ||
    asset.mimeType === 'image/gif' ||
    !/^(file|content):/.test(asset.uri)
  )
    throw new Error('Choose a local still photo.');
  const resize = resizePhoto(asset.width, asset.height);
  const context = ImageManipulator.manipulate(asset.uri);
  let image: ImageRef | undefined;
  let generated: string | undefined;
  const cleanup = () => {
    if (generated && generated !== asset.uri && generated.startsWith(Paths.cache.uri)) {
      try {
        const file = new File(generated);
        if (file.exists) file.delete();
      } catch {
        /* A failed cache cleanup must not turn a confirmed upload into a failure. */
      }
    }
  };
  try {
    if (resize) context.resize(resize);
    image = await context.renderAsync();
    const photo = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
    generated = photo.uri;
    validatePreparedPhoto(new File(photo.uri).size, photo.width, photo.height);
    const body = new FormData();
    body.append('file', new File(photo.uri));
    return { uri: photo.uri, body, cleanup };
  } catch {
    cleanup();
    throw new Error(
      'Could not prepare this photo. Select another still image up to 50 megapixels.',
    );
  } finally {
    image?.release();
    context.release();
  }
}
