import { useEffect, useRef, useState } from 'react';
import { FlatList, Platform, StyleSheet, Text, View } from 'react-native';
import {
  AndroidAudioTypePresets,
  AudioSession,
  RoomContext,
  VideoTrack,
  isTrackReference,
  useConnectionState,
  useLocalParticipant,
  useRemoteParticipants,
  useRoomContext,
  useTracks,
} from '@livekit/react-native';
import { permissions } from '@livekit/react-native-webrtc';
import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client';
import { Action, Notice } from '../../ui/components';
import { colors } from '../../ui/theme';
import { MediaLifetime } from '../calls/media-lifetime';
import type { CallKind } from '../calls/api';
import type { mediaToken } from './token';

let previousCleanup = Promise.resolve();

export function NativeMedia({
  id,
  kind,
  loadToken,
  failed,
  names,
}: {
  id: string;
  kind: CallKind;
  loadToken: () => Promise<ReturnType<typeof mediaToken>>;
  failed: () => void;
  names: Record<string, string>;
}) {
  const [room] = useState(
    () => new Room({ adaptiveStream: { pixelDensity: 'screen' }, dynacast: true }),
  );
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let audioStarted = false;
    let token: ReturnType<typeof mediaToken>;
    let alive = true;
    let release!: () => void;
    const previous = previousCleanup;
    previousCleanup = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onFailure = () => {
      if (alive) failed();
    };
    room.on(RoomEvent.Disconnected, onFailure);
    const stop = async () => {
      for (const publication of room.localParticipant.trackPublications.values())
        publication.track?.stop();
      try {
        await room.disconnect(true);
      } finally {
        if (audioStarted) await AudioSession.stopAudioSession();
      }
    };
    const lifetime = new MediaLifetime(
      [
        () => previous,
        async () => {
          if ((await permissions.request({ name: 'microphone' })) !== true)
            throw new Error('Permission denied');
        },
        async () => {
          if (kind === 'video' && (await permissions.request({ name: 'camera' })) !== true)
            throw new Error('Permission denied');
        },
        async () => {
          token = await loadToken();
        },
        async () => {
          await AudioSession.configureAudio({
            android: {
              audioTypeOptions: AndroidAudioTypePresets.communication,
              preferredOutputList:
                kind === 'video'
                  ? ['headset', 'speaker', 'earpiece']
                  : ['headset', 'earpiece', 'speaker'],
            },
            ios: { defaultOutput: kind === 'video' ? 'speaker' : 'earpiece' },
          });
        },
        async () => {
          await AudioSession.startAudioSession();
          audioStarted = true;
        },
        async () => {
          await room.connect(token.url, token.token);
        },
        async () => {
          await room.localParticipant.setMicrophoneEnabled(true);
        },
        async () => {
          if (kind === 'video') await room.localParticipant.setCameraEnabled(true);
        },
        async () => {
          if (alive) setReady(true);
        },
      ],
      stop,
      onFailure,
    );
    return () => {
      alive = false;
      room.off(RoomEvent.Disconnected, onFailure);
      void lifetime.close().finally(release);
    };
  }, [id, kind, room, loadToken, failed]);
  return (
    <RoomContext.Provider value={room}>
      {!ready ? (
        <Notice>Requesting permissions and connecting media...</Notice>
      ) : (
        <MediaControls video={kind === 'video'} names={names} />
      )}
    </RoomContext.Provider>
  );
}

function MediaControls({ video, names }: { video: boolean; names: Record<string, string> }) {
  const room = useRoomContext();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const connection = useConnectionState();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const peers = useRemoteParticipants();
  const tracks = useTracks([Track.Source.Camera]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [output, setOutput] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true;
    AudioSession.getAudioOutputs().then(
      (values) => {
        if (alive) setOutputs(values);
      },
      () => {
        if (alive) setError('Could not read audio outputs. Refresh outputs to retry.');
      },
    );
    return () => {
      alive = false;
    };
  }, [refresh]);
  async function change(operation: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch {
      if (mounted.current) setError('Could not change this media control. Please try again.');
    } finally {
      if (mounted.current) setBusy(false);
      else {
        for (const publication of room.localParticipant.trackPublications.values())
          publication.track?.stop();
        await room.disconnect(true).catch(() => {});
      }
    }
  }
  const connected = connection === ConnectionState.Connected;
  return (
    <View style={styles.controls}>
      <Notice>
        {connected
          ? peers.length
            ? `Media connected with ${peers.length} other participant(s).`
            : 'Connected. Waiting for others to join.'
          : `Media ${connection}. Controls resume when connected.`}
      </Notice>
      {!!error && <Notice error>{error}</Notice>}
      <Notice>
        {peers.map((peer) => names[peer.identity] ?? 'Participant').join(', ') ||
          'No other participant connected yet.'}
      </Notice>
      {video && (
        <FlatList
          horizontal
          data={tracks.filter(isTrackReference)}
          keyExtractor={(track) => `${track.participant.identity}-${track.source}`}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          windowSize={3}
          renderItem={({ item: track }) => (
            <View style={styles.tile}>
              <VideoTrack trackRef={track} objectFit="contain" style={styles.video} />
              <Text style={styles.label}>
                {track.participant.isLocal
                  ? 'You'
                  : (names[track.participant.identity] ?? 'Participant')}
                {track.publication.isMuted ? ' - camera off' : ''}
              </Text>
            </View>
          )}
        />
      )}
      <Action
        label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
        secondary
        busy={busy}
        disabled={!connected}
        onPress={() =>
          void change(() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled))
        }
      />
      {video && (
        <Action
          label={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
          secondary
          busy={busy}
          disabled={!connected}
          onPress={() => void change(() => localParticipant.setCameraEnabled(!isCameraEnabled))}
        />
      )}
      <Notice>
        {output
          ? `Selected audio output: ${output}`
          : 'Audio uses the call default. Choose an available output below.'}
      </Notice>
      {outputs.map((device) => (
        <Action
          key={device}
          label={`Use ${device.replace('_', ' ')}`}
          secondary
          busy={busy}
          disabled={!connected}
          onPress={() =>
            void change(async () => {
              await AudioSession.selectAudioOutput(device);
              setOutput(device);
            })
          }
        />
      ))}
      <Action
        label="Refresh audio outputs"
        secondary
        disabled={busy}
        onPress={() => setRefresh((value) => value + 1)}
      />
      {Platform.OS === 'ios' && (
        <Action
          label="Choose system audio route"
          secondary
          onPress={() => void change(() => AudioSession.showAudioRoutePicker())}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  controls: { gap: 12 },
  tile: { gap: 6, width: 270, marginRight: 12 },
  video: { height: 230, width: '100%', backgroundColor: '#14221C' },
  label: { color: colors.ink, fontWeight: '600' },
});
