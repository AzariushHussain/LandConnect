import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../ui/theme';

const icons = {
  index: ['grid-outline', 'grid'],
  chats: ['chatbubbles-outline', 'chatbubbles'],
  'call-history': ['call-outline', 'call'],
  account: ['person-circle-outline', 'person-circle'],
} as const;

export default function MainTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      backBehavior="history"
      screenOptions={({ route }) => ({
        headerShadowVisible: false,
        headerTintColor: colors.ink,
        headerStyle: { backgroundColor: colors.background },
        sceneStyle: { backgroundColor: colors.background },
        tabBarActiveTintColor: colors.green,
        tabBarInactiveTintColor: colors.muted,
        tabBarHideOnKeyboard: true,
        tabBarLabelPosition: 'below-icon',
        tabBarLabelStyle: styles.label,
        tabBarStyle: {
          height: 70 + insets.bottom,
          paddingTop: 7,
          paddingBottom: Math.max(insets.bottom, 8),
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          elevation: 0,
        },
        tabBarIcon: ({ focused }) => {
          const pair = icons[route.name as keyof typeof icons];
          return (
            <View style={[styles.icon, focused && styles.activeIcon]}>
              <Ionicons
                name={pair[focused ? 1 : 0]}
                size={24}
                color={focused ? colors.green : colors.muted}
              />
            </View>
          );
        },
      })}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Listings', tabBarAccessibilityLabel: 'Listings tab' }}
      />
      <Tabs.Screen
        name="chats"
        options={{ title: 'Chats', headerShown: false, tabBarAccessibilityLabel: 'Chats tab' }}
      />
      <Tabs.Screen
        name="call-history"
        options={{ title: 'Calls', headerShown: false, tabBarAccessibilityLabel: 'Calls tab' }}
      />
      <Tabs.Screen
        name="account"
        options={{ title: 'My Account', tabBarAccessibilityLabel: 'My Account tab' }}
      />
    </Tabs>
  );
}
const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  icon: { width: 56, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  activeIcon: { backgroundColor: colors.pale },
});
