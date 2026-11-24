import {
  ComponentProps,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, usePreventRemove } from 'expo-router';
import { listingsApi, managementApi, session } from '../../application/services';
import { useSession } from '../../application/use-session';
import { Action, Field, Notice, Screen } from '../../ui/components';
import { IconButton } from '../../ui/IconButton';
import { colors } from '../../ui/theme';
import { ListingPhoto } from '../listings/ListingPhoto';
import { isListingId, ListingRecord } from '../listings/types';
import { emptyProperty, PropertyForm, propertyFields, propertyForm } from './form';
import { choosePropertyPhoto } from './photos';
import { PhotoQueue } from './photo-queue';
import { saveProperty } from './save-property';
import { LocationPicker } from '../maps/LocationPicker';
import { locationFields } from '../maps/address-lookup';

type Active = () => boolean;
const placeholders: Record<keyof PropertyForm, string> = {
  title: 'e.g. Roadside plot near Pune',
  description: 'Describe access, surroundings and key features',
  price: '2500000',
  currency: 'INR',
  area_sq_m: '1200',
  address: 'Street, locality or landmark',
  city: 'Pune',
  state: 'Maharashtra',
  country: 'IN',
  latitude: '18.520400',
  longitude: '73.856700',
};

export function PropertyEditorScreen({ id, actor }: { id?: string; actor: string }) {
  useSession();
  const [record, setRecord] = useState<ListingRecord | null>(null),
    [form, setForm] = useState({ ...emptyProperty });
  const [photos] = useState(() => new PhotoQueue());
  const pending = useSyncExternalStore(photos.subscribe, photos.getSnapshot);
  const [loading, setLoading] = useState(!!id),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [progress, setProgress] = useState(''),
    [discard, setDiscard] = useState(false),
    [choosingLocation, setChoosingLocation] = useState(false),
    [savedId, setSavedId] = useState(id);
  const locked = useRef(false),
    mounted = useRef(true),
    generation = useRef(0);
  const fieldDirty =
    JSON.stringify(form) !== JSON.stringify(record ? propertyForm(record) : emptyProperty);
  const dirty = fieldDirty || pending.items.length > 0;
  const prevention = usePreventRemove(!discard && (busy || dirty), ({ repeat }) => {
    if (locked.current) {
      Alert.alert('Please wait', 'Wait for the current action to finish.');
      return;
    }
    Alert.alert(
      'Discard unsaved changes?',
      'Unsaved field edits and pending photo selections will be discarded. Saved photos are kept.',
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            setDiscard(true);
            repeat();
          },
        },
      ],
    );
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      photos.dispose();
    };
  }, [photos]);
  const fetchSaved = useCallback(() => {
    const target = savedId;
    if (!target || locked.current) return;
    const request = ++generation.current;
    setLoading(true);
    setError('');
    setNotice('');
    managementApi.detail(target).then(
      (value) => {
        if (!mounted.current || generation.current !== request) return;
        setRecord(value);
        setForm(propertyForm(value));
        photos.reconciled();
        setLoading(false);
      },
      (failure: unknown) => {
        if (!mounted.current || generation.current !== request) return;
        setRecord(null);
        setLoading(false);
        setError(failure instanceof Error ? failure.message : 'Could not load this property.');
      },
    );
  }, [photos, savedId]);
  useEffect(() => {
    if (id && isListingId(id)) fetchSaved();
  }, [id, fetchSaved]);
  async function run(action: (active: Active) => Promise<void>) {
    if (locked.current) return;
    const access = session.access();
    if (!access || access.user.id !== actor) return;
    const active = () => mounted.current && session.access()?.token === access.token;
    locked.current = true;
    generation.current++;
    setBusy(true);
    setError('');
    setNotice('');
    setProgress('');
    try {
      await action(active);
    } catch (failure) {
      if (active())
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not confirm this action. Refresh before repeating it.',
        );
    } finally {
      locked.current = false;
      if (mounted.current) {
        setBusy(false);
        setProgress('');
      }
    }
  }
  function confirm(
    title: string,
    message: string,
    action: (active: Active) => Promise<void>,
    destructive = false,
  ) {
    if (locked.current) return;
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: title,
        style: destructive ? 'destructive' : 'default',
        onPress: () => void run(action),
      },
    ]);
  }
  async function save(active: Active, publish = false) {
    Keyboard.dismiss();
    const saved = await saveProperty({
      form,
      record,
      publish,
      photos,
      api: managementApi,
      active,
      saved: (value) => {
        setSavedId(value.id);
        setRecord(value);
        setForm(propertyForm(value));
      },
      progress: setProgress,
    });
    if (!saved || !active()) return;
    setNotice(publish ? 'Property published with its saved photos.' : 'Property and photos saved.');
    if (!id) {
      setDiscard(true);
      prevention();
      router.replace({ pathname: '/manage/[id]', params: { id: saved.id } });
    }
  }
  async function addPhoto(active: Active) {
    setProgress('Preparing selected photo…');
    const prepared = await choosePropertyPhoto();
    if (!prepared) return;
    if (!active()) {
      prepared.cleanup();
      return;
    }
    photos.add(prepared, record?.images.length ?? 0);
    setNotice('Photo added to your selection. Save the property to upload it.');
  }
  function refresh() {
    if (!savedId || locked.current) return;
    if (fieldDirty)
      Alert.alert(
        'Replace field edits with saved details?',
        'The latest saved details and photos will be loaded. Pending photo selections are kept.',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Refresh', style: 'destructive', onPress: fetchSaved },
        ],
      );
    else fetchSaved();
  }
  const access = session.access();
  if (!access || access.user.id !== actor) return null;
  if (id && !isListingId(id))
    return (
      <Screen>
        <Notice error>Invalid property link.</Notice>
      </Screen>
    );
  const disabled = busy || loading,
    mutationDisabled = disabled || pending.blocked;
  if (loading || (savedId && !record))
    return (
      <Screen>
        {loading ? (
          <ActivityIndicator color={colors.green} accessibilityLabel="Loading property" />
        ) : (
          <>
            <Notice error>{error}</Notice>
            <Action label="Retry saved property" onPress={fetchSaved} />
          </>
        )}
      </Screen>
    );
  const photoCount = (record?.images.length ?? 0) + pending.items.length;
  function field(key: keyof PropertyForm) {
    const [, label, maxLength] = propertyFields.find(([name]) => name === key)!;
    const code = key === 'currency' || key === 'country';
    const numeric = ['price', 'area_sq_m', 'latitude', 'longitude'].includes(key);
    return (
      <Field
        label={label}
        value={form[key]}
        placeholder={placeholders[key]}
        editable={!disabled}
        maxLength={maxLength}
        multiline={key === 'description'}
        autoCapitalize={code ? 'characters' : numeric ? 'none' : 'sentences'}
        autoCorrect={!code && !numeric}
        inputMode={key === 'price' || key === 'area_sq_m' ? 'decimal' : undefined}
        onChangeText={(value) => {
          setForm((current) => ({ ...current, [key]: value }));
          setError('');
          setNotice('');
        }}
      />
    );
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: record ? 'Edit property' : 'Add property' }} />
      <View style={styles.statusRow}>
        <Text style={styles.status}>{record?.status ?? 'New draft'}</Text>
        <Text style={styles.dirty}>
          {dirty ? 'Unsaved changes' : record ? 'Saved' : 'Not saved yet'}
        </Text>
      </View>
      <Text style={styles.intro}>
        {record?.status === 'active'
          ? 'This listing is live. Saving updates its public details and photos.'
          : 'Add your details and photos. Save privately or publish when ready.'}
      </Text>
      <Section
        icon="images-outline"
        title="Property photos"
        hint={`${photoCount} / 10 photos · First saved photo is the cover`}
      >
        <View style={styles.photoGrid}>
          {record?.images.map((photo, index) => (
            <View key={photo.id} style={styles.photoTile}>
              <ListingPhoto
                uri={listingsApi.photoUrl(photo.url)}
                headers={{ Authorization: `Bearer ${access.token}` }}
                label={`Saved property photo ${index + 1}`}
                aspectRatio={1.2}
              />
              <View style={styles.remove}>
                <IconButton
                  icon="trash-outline"
                  label={`Remove saved photo ${index + 1}`}
                  tone="danger"
                  size={40}
                  disabled={mutationDisabled}
                  onPress={() =>
                    confirm(
                      'Remove photo',
                      'This saved photo is removed immediately. Other unsaved field edits and pending photos stay in the form.',
                      async (active) => {
                        await managementApi.removePhoto(record.id, photo.id);
                        if (active()) {
                          setRecord((current) =>
                            current
                              ? {
                                  ...current,
                                  images: current.images.filter((image) => image.id !== photo.id),
                                }
                              : current,
                          );
                          setNotice('Saved photo removed.');
                        }
                      },
                      true,
                    )
                  }
                />
              </View>
              <Text style={styles.photoLabel}>
                {index === 0 ? 'Cover photo' : `Saved photo ${index + 1}`}
              </Text>
            </View>
          ))}
          {pending.items.map((photo, index) => (
            <View key={photo.uri} style={styles.photoTile}>
              <ListingPhoto
                uri={photo.uri}
                label={`Pending property photo ${index + 1}`}
                aspectRatio={1.2}
              />
              <View style={styles.remove}>
                <IconButton
                  icon="close"
                  label={`Remove pending photo ${index + 1}`}
                  tone="dark"
                  size={40}
                  disabled={disabled}
                  onPress={() => photos.remove(photo.uri)}
                />
              </View>
              <Text style={styles.pendingLabel}>Pending save</Text>
            </View>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a property photo"
          accessibilityState={{ disabled: mutationDisabled || photoCount >= 10 }}
          disabled={mutationDisabled || photoCount >= 10}
          onPress={() => void run(addPhoto)}
          style={[styles.addPhoto, (mutationDisabled || photoCount >= 10) && { opacity: 0.5 }]}
        >
          <Ionicons name="add-circle-outline" size={27} color={colors.green} />
          <Text style={styles.addPhotoText}>
            {photoCount >= 10 ? 'Photo limit reached' : 'Add photo'}
          </Text>
        </Pressable>
        <Text style={styles.hint}>
          Select one photo at a time. New photos upload when you save. Saved-photo removal is
          immediate.
        </Text>
        {pending.blocked && (
          <>
            <Notice error>
              Refresh saved photos to check the last upload before adding it again.
            </Notice>
            <Action label="Refresh saved photos" secondary disabled={disabled} onPress={refresh} />
          </>
        )}
      </Section>
      <Section icon="document-text-outline" title="Property details">
        {field('title')}
        {field('description')}
      </Section>
      <Section
        icon="pricetag-outline"
        title="Price and area"
        hint="Price and area support up to 2 decimal places."
      >
        <View style={styles.fieldsRow}>
          <View style={styles.half}>{field('price')}</View>
          <View style={styles.half}>{field('area_sq_m')}</View>
        </View>
        {field('currency')}
      </Section>
      <Section
        icon="location-outline"
        title="Location"
        hint="Choose a point on the map to prefill available address details, or enter them manually. Review the address before saving."
      >
        <PropertyAction
          icon="map-outline"
          label="Choose location on map"
          disabled={disabled}
          onPress={() => setChoosingLocation(true)}
        />
        {field('address')}
        <View style={styles.fieldsRow}>
          <View style={styles.half}>{field('city')}</View>
          <View style={styles.half}>{field('state')}</View>
        </View>
        {field('country')}
        <View style={styles.fieldsRow}>
          <View style={styles.half}>{field('latitude')}</View>
          <View style={styles.half}>{field('longitude')}</View>
        </View>
        <Text style={styles.hint}>
          Coordinates allow up to 6 decimals. Use a minus sign for south or west. All fields are
          required.
        </Text>
      </Section>
      {choosingLocation && (
        <LocationPicker
          latitude={form.latitude}
          longitude={form.longitude}
          onCancel={() => setChoosingLocation(false)}
          onConfirm={({ point, address }) => {
            setForm((current) => ({ ...current, ...locationFields({ point, address }) }));
            setError('');
            setNotice(
              address && Object.keys(address).length
                ? 'Location fields updated. Check the address and fill any missing fields before saving.'
                : address === null
                  ? 'Coordinates selected. Review or enter the address, city, state and country manually.'
                  : 'No address found. Enter the address, city, state and country for this point manually.',
            );
            setChoosingLocation(false);
          }}
        />
      )}
      {!!error && <Notice error>{error}</Notice>}
      {!!notice && <Notice>{notice}</Notice>}
      {!!progress && <Notice>{progress}</Notice>}
      <Action
        label={record ? 'Save changes and photos' : 'Save private draft'}
        busy={busy}
        disabled={loading || pending.blocked}
        onPress={() => void run((active) => save(active))}
      />
      {record?.status !== 'active' && (
        <Action
          label="Publish property"
          secondary
          disabled={mutationDisabled}
          onPress={() =>
            confirm(
              'Publish property',
              'Your current details, location and selected photos will be public after saving and uploading finish successfully.',
              (active) => save(active, true),
            )
          }
        />
      )}
      {record && (
        <Section
          icon="settings-outline"
          title="Listing status"
          hint="Status changes keep unsaved field edits and pending photos in this form."
        >
          {record.status !== 'draft' && (
            <PropertyAction
              icon="eye-off-outline"
              label={record.status === 'active' ? 'Unpublish to draft' : 'Move to draft'}
              disabled={mutationDisabled}
              onPress={() =>
                confirm(
                  'Move to draft',
                  'This hides the property from public listings.',
                  async (active) => {
                    const saved = await managementApi.changeStatus(record.id, 'draft');
                    if (active()) {
                      setRecord(saved);
                      setNotice('Property is now a private draft.');
                    }
                  },
                )
              }
            />
          )}
          {record.status !== 'sold' && record.status !== 'archived' && (
            <PropertyAction
              icon="checkmark-circle-outline"
              label="Mark as sold"
              disabled={mutationDisabled}
              onPress={() =>
                confirm(
                  'Mark as sold',
                  'This hides the property from public listings and keeps its saved details and photos.',
                  async (active) => {
                    const saved = await managementApi.changeStatus(record.id, 'sold');
                    if (active()) {
                      setRecord(saved);
                      setNotice('Property marked as sold.');
                    }
                  },
                )
              }
            />
          )}
          {record.status !== 'archived' && (
            <PropertyAction
              icon="archive-outline"
              label="Archive property"
              danger
              disabled={mutationDisabled}
              onPress={() =>
                confirm(
                  'Archive property',
                  'This hides the property and keeps its saved details and photos. You can publish it again later.',
                  async (active) => {
                    await managementApi.archive(record.id);
                    if (active()) {
                      setRecord((current) =>
                        current ? { ...current, status: 'archived' } : current,
                      );
                      setNotice('Property archived.');
                    }
                  },
                  true,
                )
              }
            />
          )}
          <PropertyAction
            icon="refresh-outline"
            label="Refresh saved property"
            disabled={disabled}
            onPress={refresh}
          />
        </Section>
      )}
    </Screen>
  );
}

function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.sectionTitle}>
        <Ionicons name={icon} size={22} color={colors.green} />
        <Text style={styles.sectionText} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
      {children}
    </View>
  );
}
function PropertyAction({
  icon,
  label,
  disabled,
  onPress,
  danger = false,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  disabled: boolean;
  onPress: () => void;
  danger?: boolean;
}) {
  const tint = danger ? colors.error : colors.green;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, { opacity: disabled ? 0.45 : pressed ? 0.65 : 1 }]}
    >
      <Ionicons name={icon} color={tint} size={21} />
      <Text style={[styles.actionText, { color: tint }]}>{label}</Text>
      <Ionicons name="chevron-forward" color={colors.muted} size={17} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, padding: 18, gap: 16, backgroundColor: colors.surface },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  status: {
    color: colors.green,
    backgroundColor: colors.pale,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 11,
    textTransform: 'capitalize',
    fontSize: 12,
    fontWeight: '600',
  },
  dirty: { color: colors.muted, fontSize: 12 },
  intro: { color: colors.muted, fontSize: 13, lineHeight: 21 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionText: { color: colors.ink, fontSize: 18, fontWeight: '600' },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  fieldsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  half: { flexGrow: 1, flexBasis: 140 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  photoTile: { flexGrow: 1, flexBasis: 130, maxWidth: '100%', gap: 7 },
  remove: { position: 'absolute', top: 5, right: 5 },
  photoLabel: { color: colors.muted, fontSize: 11 },
  pendingLabel: { color: '#8A5B13', fontSize: 11, fontWeight: '500' },
  addPhoto: {
    minHeight: 86,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.green,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  addPhotoText: { color: colors.green, fontSize: 14, fontWeight: '600' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52 },
  actionText: { flex: 1, fontSize: 14, fontWeight: '500' },
});
