import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useIsFocused, usePreventRemove } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { calls, session } from '../../application/services';
import { IconButton } from '../../ui/IconButton';
import { ChatAvatar } from '../chat/ChatAvatar';
import { active, CallStatus } from './api';
import { NativeCall } from './NativeCall';
import { useCalls } from './use-calls';

const ended: Partial<Record<CallStatus, string>> = {
  ended: 'Call ended',
  cancelled: 'Call cancelled',
  rejected: 'Call declined',
  missed: 'No answer',
};
const back = () => (router.canGoBack() ? router.back() : router.replace('/chats'));
export function CallScreen() {
  const state = useCalls(),
    focused = useIsFocused(),
    call = state.call;
  const [leave, setLeave] = useState<(() => void) | null>(null);
  useEffect(() => {
    if (leave) leave();
  }, [leave]);
  usePreventRemove(!leave && (active(call) || state.busy), ({ repeat }) => {
    if (state.busy) {
      Alert.alert('Please wait', 'Wait for the call request to finish.');
      return;
    }
    Alert.alert('End this call?', 'Leaving will end or decline the call.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'End call',
        style: 'destructive',
        onPress: () => {
          void calls.finish().then(() => {
            if (!active(calls.getSnapshot().call)) setLeave(() => repeat);
          });
        },
      },
    ]);
  });
  async function finish() {
    await calls.finish();
    if (!active(calls.getSnapshot().call) && !calls.getSnapshot().busy) setLeave(() => back);
  }
  const incoming = call?.callee.id === session.access()?.user.id;
  const peer = call ? (incoming ? call.caller : call.callee) : null;
  const ringing = call?.status === 'ringing';
  const accepted = call?.status === 'accepted';
  const kind = call?.kind ?? state.attempt?.kind ?? 'audio';
  if (accepted && kind === 'video' && focused && state.joined && state.verified && state.foreground)
    return (
      <View style={{ flex: 1, backgroundColor: '#0B141A' }}>
        <NativeCall
          key={call.id}
          call={call}
          videoOptions={{
            title: peer?.display_name ?? 'Video call',
            onBack: back,
            onEnd: () => void finish(),
            endBusy: state.busy,
          }}
        />
      </View>
    );
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.top}>
        <IconButton icon="chevron-back" label="Back from call" tone="dark" onPress={back} />
        <View style={styles.brand}>
          <Ionicons
            name={kind === 'video' ? 'videocam-outline' : 'call-outline'}
            size={14}
            color="#BDDBCB"
          />
          <Text style={styles.caption}>LandConnect {kind} call</Text>
        </View>
        <View style={{ width: 46 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {(!accepted || call?.kind === 'audio') && (
          <ChatAvatar name={peer?.display_name ?? 'LandConnect'} size={112} dark />
        )}
        <Text style={styles.name}>
          {peer?.display_name ?? (state.attempt || state.busy ? 'Connecting…' : 'Your calls')}
        </Text>
        {ringing && (
          <Text accessibilityLiveRegion="polite" style={styles.status}>
            {incoming ? `Incoming ${call.kind} call` : 'Calling…'}
          </Text>
        )}
        {call && ended[call.status] && (
          <Text accessibilityLiveRegion="polite" style={styles.status}>
            {ended[call.status]}
          </Text>
        )}
        {!call && !state.attempt && !state.busy && (
          <Text style={styles.status}>Start a call from a chat or property listing.</Text>
        )}
        {!!state.error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {state.error}
          </Text>
        )}
        {state.busy && <ActivityIndicator color="#D9E8E0" accessibilityLabel="Preparing call" />}
        {state.attempt && !state.busy && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry outgoing call"
            onPress={() => void calls.retry()}
            style={styles.reconnect}
          >
            <Ionicons name="call-outline" size={22} color="white" />
            <Text style={styles.link}>Retry call</Text>
          </Pressable>
        )}
        {accepted && (
          <>
            {focused && state.joined && state.verified && state.foreground ? (
              <NativeCall key={call.id} call={call} />
            ) : (
              !state.busy && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void calls.join()}
                  style={styles.reconnect}
                >
                  <Ionicons name="refresh-outline" size={22} color="white" />
                  <Text style={styles.link}>Reconnect call</Text>
                </Pressable>
              )
            )}
          </>
        )}
        {!!state.error && (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void Linking.openSettings().catch(() =>
                Alert.alert(
                  'Settings unavailable',
                  'Open LandConnect permissions in device settings.',
                ),
              );
            }}
          >
            <Text style={styles.link}>Open permission settings</Text>
          </Pressable>
        )}
        {!active(call) && !state.busy && !state.attempt && (
          <Pressable accessibilityRole="button" onPress={back} style={styles.reconnect}>
            <Text style={styles.link}>Done</Text>
          </Pressable>
        )}
      </ScrollView>
      {active(call) && (
        <View style={styles.bottom}>
          {incoming && ringing ? (
            <View style={styles.answerRow}>
              <IconButton
                icon="call"
                label="Decline call"
                caption="Decline"
                tone="danger"
                size={68}
                busy={state.busy}
                onPress={() => void finish()}
              />
              <IconButton
                icon={call.kind === 'video' ? 'videocam' : 'call'}
                label="Answer call"
                caption="Answer"
                tone="success"
                size={68}
                busy={state.busy}
                disabled={!state.foreground || !state.verified}
                onPress={() => void calls.accept()}
              />
            </View>
          ) : (
            <IconButton
              icon="call"
              label={ringing ? 'Cancel call' : 'End call'}
              caption={ringing ? 'Cancel' : 'End call'}
              tone="danger"
              size={68}
              busy={state.busy}
              onPress={() => void finish()}
            />
          )}
        </View>
      )}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0B211B' },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  caption: { color: '#BDDBCB', fontSize: 13 },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 26, gap: 22 },
  name: { color: '#FFFFFF', fontSize: 29, fontWeight: '600', textAlign: 'center' },
  status: { color: '#BDDBCB', fontSize: 18, textAlign: 'center' },
  error: { color: '#F7B9BE', textAlign: 'center', lineHeight: 22 },
  bottom: { alignItems: 'center', padding: 22, paddingBottom: 28 },
  answerRow: { flexDirection: 'row', justifyContent: 'space-evenly', width: '100%' },
  reconnect: {
    flexDirection: 'row',
    padding: 14,
    borderRadius: 24,
    backgroundColor: '#234A3B',
    alignItems: 'center',
    gap: 9,
  },
  link: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
