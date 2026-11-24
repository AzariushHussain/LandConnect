import { useLocalSearchParams } from 'expo-router';
import { Notice, Screen } from '../../ui/components';
import { isListingId } from '../../features/listings/types';
import { PropertyMapScreen } from '../../features/maps/PropertyMapScreen';

export default function PropertyMapRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  if (typeof id !== 'string' || !isListingId(id))
    return (
      <Screen>
        <Notice error>Open the map from a property.</Notice>
      </Screen>
    );
  return <PropertyMapScreen key={id} id={id} />;
}
