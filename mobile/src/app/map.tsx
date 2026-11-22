import { useLocalSearchParams } from 'expo-router';
import { Notice, Screen } from '../ui/components';
import { routeFilters } from '../features/maps/api';
import { readCoordinate, LngLat } from '../features/maps/geo';
import { MapScreen } from '../features/maps/MapScreen';
import { ListingFilters } from '../features/listings/filters';

export default function MapRoute() {
  const params = useLocalSearchParams<{
    filters?: string;
    latitude?: string;
    longitude?: string;
  }>();
  let parsed: { filters: ListingFilters; initialCenter: LngLat | null } | undefined;
  let error = '';
  try {
    if (Object.values(params).some((value) => typeof value !== 'string'))
      throw new Error('Invalid map link.');
    const filters = routeFilters(params.filters);
    const initialCenter =
      params.latitude !== undefined && params.longitude !== undefined
        ? readCoordinate(params.latitude, params.longitude)
        : null;
    if ((params.latitude !== undefined || params.longitude !== undefined) && !initialCenter)
      throw new Error('Invalid map coordinates. Open the map from a property.');
    parsed = { filters, initialCenter };
  } catch (failure) {
    error = failure instanceof Error ? failure.message : 'Invalid map link.';
  }
  if (!parsed)
    return (
      <Screen>
        <Notice error>{error}</Notice>
      </Screen>
    );
  return <MapScreen key={JSON.stringify(params)} {...parsed} />;
}
