import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../../ui/theme';
import { useMeeting } from './use-meetings';

export function MeetingBanner() {
  const state = useMeeting(),
    path = usePathname();
  const id = state.joined ? state.id : state.invitation;
  if (!id || !state.foreground || path === `/meetings/${id}`) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open meeting"
      style={styles.banner}
      onPress={() => router.navigate({ pathname: '/meetings/[id]', params: { id } })}
    >
      <Text accessibilityLiveRegion="polite" style={styles.text}>
        {state.joined
          ? 'Meeting session open. Tap for controls.'
          : 'Meeting invitation. Tap to review.'}
      </Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  banner: { padding: 16, backgroundColor: colors.pale },
  text: { color: colors.green, fontWeight: '700' },
});
