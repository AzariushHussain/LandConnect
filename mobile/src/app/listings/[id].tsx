import { useLocalSearchParams } from 'expo-router';
import { Heading, Screen } from '../../ui/components';
import { ListingDetailsScreen } from '../../features/listings/ListingDetailsScreen';
import { isListingId } from '../../features/listings/types';

export default function PropertyRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  if (typeof id !== 'string' || !isListingId(id))
    return (
      <Screen>
        <Heading title="Property unavailable." detail="This property link is invalid." />
      </Screen>
    );
  return <ListingDetailsScreen key={id} id={id} />;
}
