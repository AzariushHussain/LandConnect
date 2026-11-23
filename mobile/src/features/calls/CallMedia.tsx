import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  AudioSession,
  isTrackReference,
  useConnectionState,
  useLocalParticipant,
  useRemoteParticipants,
  useRoomContext,
  useTracks,
} from '@livekit/react-native';
import { ConnectionState, Track } from 'livekit-client';
import { IconButton } from '../../ui/IconButton';
import { CallVideoStage } from './CallVideoStage';
import { VideoCallControls, VideoCallFrame, VideoCallOptions } from './VideoCallFrame';
import { cameraCapture, videoPublishDefaults } from '../media/capture';
import { switchCameraSource } from '../media/switch-camera';

export function CallMedia({
  group = false,
  names = {},
  videoOptions,
}: {
  group?: boolean;
  names?: Record<string, string>;
  videoOptions?: VideoCallOptions;
}) {
  const room = useRoomContext(),
    connection = useConnectionState(),
    peers = useRemoteParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const tracks = useTracks([Track.Source.Camera]).filter(isTrackReference);
  const [busy, setBusy] = useState(false),
    [cameraBusy, setCameraBusy] = useState(false),
    [error, setError] = useState(''),
    [output, setOutput] = useState(''),
    [outputs, setOutputs] = useState<string[] | null>(null),
    [frontFacing, setFrontFacing] = useState(true);
  const alive = useRef(true),
    changing = useRef(false),
    changingCamera = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const connected = connection === ConnectionState.Connected;
  const status = connected
    ? peers.length
      ? group
        ? `${peers.length + 1} people connected`
        : 'Connected'
      : group
        ? 'Waiting for others…'
        : 'Waiting for the other person…'
    : connection === ConnectionState.Reconnecting ||
        connection === ConnectionState.SignalReconnecting
      ? 'Reconnecting…'
      : 'Connecting…';
  async function change(operation: () => Promise<unknown>) {
    if (changing.current) return;
    changing.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch {
      if (alive.current) setError('Could not change this control. Try again.');
    } finally {
      changing.current = false;
      if (alive.current) setBusy(false);
      else {
        for (const publication of room.localParticipant.trackPublications.values())
          publication.track?.stop();
        await room.disconnect(true).catch(() => {});
      }
    }
  }
  async function flipCamera() {
    const track = localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
    if (!track) throw new Error('Camera is not available');
    const current = track.mediaStreamTrack.getSettings().facingMode;
    const next =
      (current ?? (frontFacing ? 'user' : 'environment')) === 'user' ? 'environment' : 'user';
    const actual = await switchCameraSource(
      track,
      next,
      () => alive.current && room.state !== ConnectionState.Disconnected,
    );
    if (alive.current && actual) setFrontFacing(actual === 'user');
  }
  async function cameraChange(operation: () => Promise<unknown>) {
    if (changingCamera.current) return;
    changingCamera.current = true;
    setCameraBusy(true);
    setError('');
    const timer = setTimeout(() => {
      if (alive.current)
        setError('The camera is taking longer than expected. Audio and End remain available.');
    }, 8000);
    try {
      await operation();
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof Error && failure.message.startsWith('Could not switch')
            ? failure.message
            : 'Could not change the camera. Audio is still available.',
        );
    } finally {
      clearTimeout(timer);
      changingCamera.current = false;
      if (alive.current) setCameraBusy(false);
      else {
        for (const publication of room.localParticipant.trackPublications.values())
          publication.track?.stop();
        await room.disconnect(true).catch(() => {});
      }
    }
  }
  async function toggleCamera() {
    if (isCameraEnabled) {
      await localParticipant.setCameraEnabled(false);
      return;
    }
    const previous = localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
    if (previous) await localParticipant.unpublishTrack(previous);
    if (!alive.current || room.state !== ConnectionState.Connected) return;
    await localParticipant.setCameraEnabled(
      true,
      cameraCapture(frontFacing ? 'user' : 'environment'),
      videoPublishDefaults,
    );
  }
  async function audioOutputs() {
    try {
      const available = await AudioSession.getAudioOutputs();
      if (!alive.current) return;
      if (available.length) setOutputs(available);
      else setError('No audio outputs are available. Try again.');
    } catch {
      if (alive.current) setError('Could not find audio outputs. Try again.');
    }
  }
  const picker = (
    <Modal
      visible={outputs !== null}
      transparent
      animationType="slide"
      onRequestClose={() => setOutputs(null)}
    >
      <View style={styles.scrim}>
        <View style={styles.outputMenu} accessibilityViewIsModal>
          <View style={styles.handle} />
          <Text accessibilityRole="header" style={styles.outputTitle}>
            Audio output
          </Text>
          <ScrollView>
            {outputs?.map((device) => (
              <Pressable
                key={device}
                accessibilityRole="button"
                accessibilityState={{ selected: device === output }}
                onPress={() => {
                  setOutputs(null);
                  void change(async () => {
                    await AudioSession.selectAudioOutput(device);
                    if (alive.current) setOutput(device);
                  });
                }}
                style={styles.outputOption}
              >
                <Text style={styles.outputText}>
                  {device.replaceAll('_', ' ')}
                  {device === output ? ' ✓' : ''}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            onPress={() => setOutputs(null)}
            style={styles.outputOption}
          >
            <Text style={styles.outputText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
  if (videoOptions)
    return (
      <VideoCallFrame
        title={videoOptions.title}
        status={`${group ? 'Group video call' : 'Video call'} · ${status}`}
        onBack={videoOptions.onBack}
        insetStage={group}
        error={error}
        action={
          <IconButton
            icon="camera-reverse-outline"
            label="Switch front or rear camera"
            tone="dark"
            busy={cameraBusy}
            disabled={!connected || !isCameraEnabled}
            onPress={() => void cameraChange(flipCamera)}
          />
        }
        controls={
          <VideoCallControls
            options={videoOptions}
            enabled={connected}
            busy={busy}
            cameraBusy={cameraBusy}
            muted={!isMicrophoneEnabled}
            camera={isCameraEnabled}
            onMute={() =>
              void change(() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled))
            }
            onCamera={() => void cameraChange(toggleCamera)}
            onAudio={() => void audioOutputs()}
          />
        }
      >
        <CallVideoStage
          group={group}
          local={localParticipant}
          peers={peers}
          tracks={tracks}
          names={names}
          frontFacing={frontFacing}
        />
        {picker}
      </VideoCallFrame>
    );
  return (
    <View style={styles.body}>
      {picker}
      <Text accessibilityLiveRegion="polite" style={styles.status}>
        {status}
      </Text>
      {group && peers.length > 0 && (
        <Text style={styles.status}>
          {peers.map((peer) => names[peer.identity] ?? 'Participant').join(', ')}
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <View style={styles.controls}>
        <IconButton
          icon={isMicrophoneEnabled ? 'mic-outline' : 'mic-off-outline'}
          label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
          caption={isMicrophoneEnabled ? 'Mute' : 'Unmute'}
          tone="dark"
          size={60}
          selected={!isMicrophoneEnabled}
          busy={busy}
          disabled={!connected}
          onPress={() =>
            void change(() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled))
          }
        />
        <IconButton
          icon={output.includes('speaker') ? 'volume-high-outline' : 'volume-medium-outline'}
          label="Choose audio output"
          caption="Audio"
          tone="dark"
          size={60}
          disabled={busy || !connected}
          onPress={() => void audioOutputs()}
        />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  body: { width: '100%', gap: 22 },
  scrim: { flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' },
  outputMenu: {
    backgroundColor: '#17282F',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingBottom: 36,
    maxHeight: '70%',
  },
  handle: {
    height: 4,
    width: 36,
    backgroundColor: '#6B8088',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 14,
  },
  outputTitle: { fontSize: 20, fontWeight: '600', color: '#FFFFFF', padding: 12 },
  outputOption: { padding: 16, minHeight: 48 },
  outputText: { fontSize: 16, color: '#E0EDEF' },
  status: { textAlign: 'center', color: '#CAE0D4', fontSize: 17 },
  controls: { flexDirection: 'row', justifyContent: 'space-evenly', gap: 16 },
  error: { color: '#F7B9BE', textAlign: 'center' },
});
