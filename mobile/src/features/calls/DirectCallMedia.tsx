import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  AudioSession,
  VideoTrack,
  isTrackReference,
  useConnectionState,
  useLocalParticipant,
  useRemoteParticipants,
  useRoomContext,
  useTracks,
} from '@livekit/react-native';
import { ConnectionState, Track } from 'livekit-client';
import { IconButton } from '../../ui/IconButton';

export function DirectCallMedia({ video }: { video: boolean }) {
  const room = useRoomContext(),
    connection = useConnectionState(),
    peers = useRemoteParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const tracks = useTracks([Track.Source.Camera]).filter(isTrackReference);
  const remote = tracks.find((t) => !t.participant.isLocal),
    local = tracks.find((t) => t.participant.isLocal);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [output, setOutput] = useState(''),
    [outputs, setOutputs] = useState<string[] | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const connected = connection === ConnectionState.Connected;
  async function change(operation: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch {
      if (alive.current) setError('Could not change this control. Try again.');
    } finally {
      if (alive.current) setBusy(false);
      else {
        for (const p of room.localParticipant.trackPublications.values()) p.track?.stop();
        await room.disconnect(true).catch(() => {});
      }
    }
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
  return (
    <View style={styles.body}>
      <Modal
        visible={outputs !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setOutputs(null)}
      >
        <View style={styles.scrim}>
          <View style={styles.outputMenu} accessibilityViewIsModal>
            <Text accessibilityRole="header" style={styles.outputTitle}>
              Audio output
            </Text>
            <ScrollView>
              {outputs?.map((device) => (
                <Pressable
                  key={device}
                  accessibilityRole="button"
                  onPress={() => {
                    setOutputs(null);
                    void change(async () => {
                      await AudioSession.selectAudioOutput(device);
                      if (alive.current) setOutput(device);
                    });
                  }}
                  style={styles.outputOption}
                >
                  <Text style={styles.outputText}>{device.replaceAll('_', ' ')}</Text>
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
      <Text accessibilityLiveRegion="polite" style={styles.status}>
        {connected
          ? peers.length
            ? 'Connected'
            : 'Connecting to the other person…'
          : connection === ConnectionState.Reconnecting
            ? 'Reconnecting…'
            : 'Connecting…'}
      </Text>
      {video && (
        <View style={styles.video}>
          {remote && !remote.publication.isMuted ? (
            <VideoTrack trackRef={remote} objectFit="contain" style={StyleSheet.absoluteFill} />
          ) : (
            <Text style={styles.placeholder}>Waiting for camera</Text>
          )}
          {local && !local.publication.isMuted && (
            <View style={styles.preview}>
              <VideoTrack
                trackRef={local}
                mirror
                objectFit="cover"
                style={StyleSheet.absoluteFill}
              />
            </View>
          )}
        </View>
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
        {video && (
          <IconButton
            icon={isCameraEnabled ? 'videocam-outline' : 'videocam-off-outline'}
            label={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
            caption="Camera"
            tone="dark"
            size={60}
            selected={!isCameraEnabled}
            busy={busy}
            disabled={!connected}
            onPress={() => void change(() => localParticipant.setCameraEnabled(!isCameraEnabled))}
          />
        )}
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
  scrim: {
    flex: 1,
    backgroundColor: '#00000088',
    justifyContent: 'center',
    padding: 28,
  },
  outputMenu: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, maxHeight: '70%' },
  outputTitle: { fontSize: 20, fontWeight: '600', color: '#0B211B', padding: 12 },
  outputOption: { padding: 14, minHeight: 48 },
  outputText: { fontSize: 16, color: '#0B211B' },
  status: { textAlign: 'center', color: '#CAE0D4', fontSize: 17 },
  video: {
    height: 330,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#061810',
    alignItems: 'center',
    justifyContent: 'center',
  },
  preview: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    width: 96,
    height: 130,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#173A2E',
  },
  placeholder: { color: '#CAE0D4' },
  controls: { flexDirection: 'row', justifyContent: 'space-evenly', gap: 16 },
  error: { color: '#F7B9BE', textAlign: 'center' },
});
