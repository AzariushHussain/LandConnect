import { pickedCoordinate } from './geo';

export type LocationPort = {
  requestPermission(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  servicesEnabled(): Promise<boolean>;
  position(): Promise<{ coords: { longitude: number; latitude: number; accuracy: number | null } }>;
};
class LocationError extends Error {}
export async function locateOnce(port: LocationPort) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const permission = await port.requestPermission();
    if (!permission.granted)
      throw new LocationError(
        permission.canAskAgain
          ? 'Location permission was declined. You can choose a location manually.'
          : 'Location permission is off. Enable it in system settings or choose a location manually.',
      );
    if (!(await port.servicesEnabled()))
      throw new LocationError(
        'Device location is off. Enable it in system settings or choose a location manually.',
      );
    const result = await Promise.race([
      port.position(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new LocationError('Location took too long. Try again or choose a location manually.'),
            ),
          15000,
        );
      }),
    ]);
    return {
      ...pickedCoordinate([result.coords.longitude, result.coords.latitude]),
      accuracy:
        Number.isFinite(result.coords.accuracy) &&
        result.coords.accuracy !== null &&
        result.coords.accuracy >= 0
          ? Math.ceil(result.coords.accuracy)
          : null,
    };
  } catch (failure) {
    if (failure instanceof LocationError) throw failure;
    throw new Error('Could not read device location. Try again or choose a location manually.');
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
