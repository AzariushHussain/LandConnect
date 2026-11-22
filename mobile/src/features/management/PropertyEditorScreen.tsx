import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { router, usePreventRemove } from 'expo-router';
import { listingsApi, managementApi, session } from '../../application/services';
import { useSession } from '../../application/use-session';
import { Action, Field, Heading, Notice, Screen } from '../../ui/components';
import { colors } from '../../ui/theme';
import { ListingPhoto } from '../listings/ListingPhoto';
import { isListingId, ListingRecord } from '../listings/types';
import { emptyProperty, propertyFields, propertyForm, validateProperty } from './form';
import { choosePropertyPhoto } from './photos';

export function PropertyEditorScreen({ id }: { id?: string }) {
  useSession();
  const [record, setRecord] = useState<ListingRecord | null>(null);
  const [form, setForm] = useState({ ...emptyProperty });
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [discard, setDiscard] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const dirty =
    JSON.stringify(form) !== JSON.stringify(record ? propertyForm(record) : emptyProperty);
  const prevention = usePreventRemove(!discard && (busy || dirty), ({ repeat }) => {
    if (locked.current) {
      Alert.alert('Please wait', 'Wait for the current action to finish.');
      return;
    }
    Alert.alert('Discard unsaved changes?', 'Your unsaved property details will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          setDiscard(true);
          repeat();
        },
      },
    ]);
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchSaved = useCallback(() => {
    if (!id || locked.current) return;
    const current = ++generation.current;
    return managementApi.detail(id).then(
      (listing) => {
        if (!mounted.current || generation.current !== current) return;
        setRecord(listing);
        setForm(propertyForm(listing));
        setLoading(false);
      },
      (failure: unknown) => {
        if (!mounted.current || generation.current !== current) return;
        setError(failure instanceof Error ? failure.message : 'Could not load this property.');
        setLoading(false);
      },
    );
  }, [id]);
  function reload() {
    if (locked.current) return;
    setLoading(true);
    setError('');
    setNotice('');
    void fetchSaved();
  }
  useEffect(() => {
    if (id && isListingId(id)) void fetchSaved();
  }, [id, fetchSaved]);

  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not complete this action. Please refresh.',
        );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const confirm = (
    title: string,
    message: string,
    action: () => Promise<void>,
    destructive = false,
  ) => {
    if (locked.current) return;
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: title,
        style: destructive ? 'destructive' : 'default',
        onPress: () => void run(action),
      },
    ]);
  };
  const save = async (publish = false) => {
    validateProperty(form);
    const saved = record
      ? await managementApi.save(record.id, form, publish ? 'active' : undefined)
      : await managementApi.create(form);
    if (!mounted.current) return;
    setRecord(saved);
    setForm(propertyForm(saved));
    setNotice(publish ? 'Property published to the community.' : 'Property details saved.');
    if (!id) {
      setDiscard(true);
      prevention();
      router.replace({ pathname: '/manage/[id]', params: { id: saved.id } });
    }
  };
  const moveToDraft = async () => {
    if (!record) return;
    const saved = await managementApi.changeStatus(record.id, 'draft');
    if (mounted.current) {
      setRecord(saved);
      setNotice('Property is now a private draft. Unsaved field edits remain in this form.');
    }
  };
  const addPhoto = async () => {
    if (!record) return;
    const prepared = await choosePropertyPhoto();
    if (!prepared) return;
    try {
      const image = await managementApi.upload(record.id, prepared.body);
      if (mounted.current) {
        setRecord((current) =>
          current ? { ...current, images: [...current.images, image] } : current,
        );
        setNotice('Photo uploaded.');
      }
    } finally {
      prepared.cleanup();
    }
  };
  const token = session.access()?.token;
  const disabled = busy || loading;
  if (id && !isListingId(id))
    return (
      <Screen>
        <Notice error>Invalid property link.</Notice>
      </Screen>
    );
  return (
    <Screen>
      <Heading
        title={id ? 'Manage property' : 'Add a property'}
        detail="Only active properties are public. Publishing makes property details, location and photos visible to the community."
      />
      {record && <Text style={styles.status}>Status: {record.status}</Text>}
      {loading && <ActivityIndicator color={colors.green} accessibilityLabel="Loading property" />}
      {!!error && <Notice error>{error}</Notice>}
      {!!notice && <Notice>{notice}</Notice>}
      {(!id || record) && (
        <>
          {propertyFields.map(([key, label, maxLength]) => (
            <Field
              key={key}
              label={label}
              value={form[key]}
              editable={!disabled}
              maxLength={maxLength}
              multiline={key === 'description'}
              autoCapitalize={key === 'currency' || key === 'country' ? 'characters' : 'sentences'}
              autoCorrect={
                !['price', 'area_sq_m', 'latitude', 'longitude', 'currency', 'country'].includes(
                  key,
                )
              }
              inputMode={key === 'price' || key === 'area_sq_m' ? 'decimal' : undefined}
              onChangeText={(value) => setForm((current) => ({ ...current, [key]: value }))}
            />
          ))}
          <Notice>
            All fields are required. Coordinates use decimal degrees (up to 6 decimal places); use a
            minus sign for south or west. Price and area allow 2 decimal places.
          </Notice>
          <Action
            label={record ? 'Save changes' : 'Save private draft'}
            busy={busy}
            disabled={loading}
            onPress={() => void run(() => save())}
          />
          {record && (
            <>
              <Action
                label={record.status === 'active' ? 'Save and publish changes' : 'Publish property'}
                secondary
                disabled={disabled}
                onPress={() =>
                  confirm(
                    'Publish property',
                    'Your current form details and existing photos will be visible to everyone who browses LandConnect.',
                    () => save(true),
                  )
                }
              />
              {record.status !== 'draft' && (
                <Action
                  label={record.status === 'active' ? 'Unpublish to draft' : 'Move to draft'}
                  secondary
                  disabled={disabled}
                  onPress={() =>
                    confirm(
                      'Move to draft',
                      'This hides the property from the community. Unsaved field edits stay in this form.',
                      moveToDraft,
                    )
                  }
                />
              )}
              {record.status !== 'archived' && (
                <Action
                  label="Archive property"
                  secondary
                  disabled={disabled}
                  onPress={() =>
                    confirm(
                      'Archive property',
                      'This hides the property and keeps its details and photos. You can publish it again later. Unsaved field edits stay in this form.',
                      async () => {
                        await managementApi.archive(record.id);
                        if (mounted.current) {
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
              {record.status !== 'sold' && record.status !== 'archived' && (
                <Action
                  label="Mark as sold"
                  secondary
                  disabled={disabled}
                  onPress={() =>
                    confirm(
                      'Mark as sold',
                      'This removes the property from the community. Its details and photos are kept. Unsaved field edits stay in this form.',
                      async () => {
                        const saved = await managementApi.changeStatus(record.id, 'sold');
                        if (mounted.current) {
                          setRecord(saved);
                          setNotice('Property marked as sold.');
                        }
                      },
                    )
                  }
                />
              )}
              <Heading
                title="Property photos"
                detail={`${record.images.length} of 10 photos. Choose a still image; it will be resized and uploaded as JPEG. Photo changes are saved immediately, independently of the form.`}
              />
              {record.status === 'active' && (
                <Notice>Photo changes to this published property become public immediately.</Notice>
              )}
              {record.images.map((photo, index) => (
                <View key={photo.id} style={styles.photo}>
                  {token && (
                    <ListingPhoto
                      uri={listingsApi.photoUrl(photo.url)}
                      headers={{ Authorization: `Bearer ${token}` }}
                      label={`Property photo ${index + 1}`}
                    />
                  )}
                  <Action
                    label={`Remove photo ${index + 1}`}
                    secondary
                    disabled={disabled}
                    onPress={() =>
                      confirm(
                        'Remove photo',
                        'This permanently removes this photo. Your property details are kept.',
                        async () => {
                          await managementApi.removePhoto(record.id, photo.id);
                          if (mounted.current) {
                            setRecord((current) =>
                              current
                                ? {
                                    ...current,
                                    images: current.images.filter((image) => image.id !== photo.id),
                                  }
                                : current,
                            );
                            setNotice('Photo removed.');
                          }
                        },
                        true,
                      )
                    }
                  />
                </View>
              ))}
              <Action
                label="Choose and upload a photo"
                secondary
                disabled={disabled || record.images.length >= 10}
                onPress={() => void run(addPhoto)}
              />
            </>
          )}
        </>
      )}
      {id && (
        <Action
          label="Refresh saved property"
          secondary
          disabled={disabled}
          onPress={() => {
            if (dirty)
              Alert.alert(
                'Discard field edits and refresh?',
                'The latest saved property will replace this form.',
                [
                  { text: 'Keep editing', style: 'cancel' },
                  { text: 'Refresh', style: 'destructive', onPress: () => void reload() },
                ],
              );
            else void reload();
          }}
        />
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  status: { color: colors.green, fontSize: 16, fontWeight: '700', textTransform: 'capitalize' },
  photo: { gap: 12 },
});
