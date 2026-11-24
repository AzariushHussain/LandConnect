import { useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Action, Field, Notice } from '../../ui/components';
import { IconButton } from '../../ui/IconButton';
import { colors } from '../../ui/theme';
import { emptyFilters, ListingFilters, normalizeFilters } from './filters';

export function ListingFiltersSheet({
  value,
  onClose,
  onApply,
}: {
  value: ListingFilters;
  onClose: () => void;
  onApply: (filters: ListingFilters) => void;
}) {
  const [draft, setDraft] = useState({ ...value }),
    [error, setError] = useState('');
  function field(key: keyof ListingFilters, label: string, numeric = false, placeholder?: string) {
    return (
      <View style={numeric ? styles.field : undefined}>
        <Field
          label={label}
          value={draft[key]}
          placeholder={placeholder}
          onChangeText={(text) => setDraft((current) => ({ ...current, [key]: text }))}
          maxLength={key === 'country' ? 2 : key === 'currency' ? 3 : numeric ? 15 : 100}
          keyboardType={numeric ? 'decimal-pad' : 'default'}
          autoCorrect={false}
          autoCapitalize={key === 'country' || key === 'currency' ? 'characters' : 'words'}
        />
      </View>
    );
  }
  function apply() {
    try {
      const filters = normalizeFilters(draft);
      Keyboard.dismiss();
      onApply(filters);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Check your filters.');
    }
  }
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          style={styles.safe}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              Filters
            </Text>
            <IconButton icon="close" label="Close filters" onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Location</Text>
              {field('city', 'City', false, 'Any city')}
              {field('state', 'State', false, 'Any state')}
              {field('country', 'Country code', false, 'e.g. IN')}
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Budget</Text>
              <Text style={styles.hint}>Choose a currency to compare prices.</Text>
              {field('currency', 'Currency code', false, 'e.g. INR')}
              <View style={styles.range}>
                {field('min_price', 'Minimum price', true, 'No minimum')}
                {field('max_price', 'Maximum price', true, 'No maximum')}
              </View>
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Land area</Text>
              <Text style={styles.hint}>All areas are in square metres (m²).</Text>
              <View style={styles.range}>
                {field('min_area', 'Minimum area (m²)', true, 'No minimum')}
                {field('max_area', 'Maximum area (m²)', true, 'No maximum')}
              </View>
            </View>
            {!!error && <Notice error>{error}</Notice>}
          </ScrollView>
          <View style={styles.footer}>
            <View style={styles.reset}>
              <Action
                label="Reset filters"
                secondary
                onPress={() => {
                  setDraft({ ...emptyFilters, q: value.q });
                  setError('');
                }}
              />
            </View>
            <View style={styles.apply}>
              <Action label="Apply filters" onPress={apply} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: colors.surface,
  },
  title: { color: colors.ink, fontSize: 24, fontWeight: '600' },
  body: { padding: 20, gap: 20 },
  section: { padding: 18, gap: 14, borderRadius: 20, backgroundColor: colors.surface },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '600' },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  range: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  field: { flexGrow: 1, flexBasis: 130 },
  footer: { flexDirection: 'row', padding: 18, gap: 12, backgroundColor: colors.surface },
  reset: { flex: 1 },
  apply: { flex: 1.3 },
});
