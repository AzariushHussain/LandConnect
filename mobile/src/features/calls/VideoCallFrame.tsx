import { ReactNode, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { IconButton } from '../../ui/IconButton';
import { ChatAvatar } from '../chat/ChatAvatar';

export type VideoCallOptions = {
  title: string;
  onBack: () => void;
  onEnd: () => void;
  endBusy?: boolean;
  endLabel?: string;
  endCaption?: string;
};

export function VideoCallFrame({
  title,
  status,
  onBack,
  controls,
  children,
  action,
  error,
  insetStage = false,
}: {
  title: string;
  status: string;
  onBack: () => void;
  controls: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  error?: string;
  insetStage?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [header, setHeader] = useState(84 + insets.top),
    [footer, setFooter] = useState(120 + insets.bottom);
  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <View style={[styles.stage, insetStage && { paddingTop: header, paddingBottom: footer }]}>
        {children}
      </View>
      <SafeAreaView
        edges={['top', 'left', 'right']}
        style={styles.header}
        onLayout={(event) => setHeader(event.nativeEvent.layout.height)}
      >
        <View style={styles.headerRow}>
          <IconButton
            icon="chevron-back"
            label="Back from video call"
            tone="dark"
            onPress={onBack}
          />
          <View style={styles.identity}>
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            <Text numberOfLines={2} accessibilityLiveRegion="polite" style={styles.status}>
              {status}
            </Text>
          </View>
          {action ?? <View style={{ width: 46 }} />}
        </View>
      </SafeAreaView>
      <SafeAreaView
        edges={['bottom', 'left', 'right']}
        style={styles.footer}
        onLayout={(event) => setFooter(event.nativeEvent.layout.height)}
      >
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        <View style={styles.dock}>{controls}</View>
      </SafeAreaView>
    </View>
  );
}

export function VideoCallControls({
  options,
  enabled = false,
  muted = false,
  camera = false,
  busy = false,
  onMute,
  onCamera,
  onAudio,
}: {
  options: VideoCallOptions;
  enabled?: boolean;
  muted?: boolean;
  camera?: boolean;
  busy?: boolean;
  onMute?: () => void;
  onCamera?: () => void;
  onAudio?: () => void;
}) {
  return (
    <View style={styles.controlRow}>
      <IconButton
        icon={camera ? 'videocam-outline' : 'videocam-off-outline'}
        label={camera ? 'Turn camera off' : 'Turn camera on'}
        caption="Camera"
        tone="dark"
        size={54}
        selected={!camera}
        busy={busy}
        disabled={!enabled || !onCamera}
        onPress={() => onCamera?.()}
      />
      <IconButton
        icon={muted ? 'mic-off-outline' : 'mic-outline'}
        label={muted ? 'Unmute microphone' : 'Mute microphone'}
        caption={muted ? 'Unmute' : 'Mute'}
        tone="dark"
        size={54}
        selected={muted}
        busy={busy}
        disabled={!enabled || !onMute}
        onPress={() => onMute?.()}
      />
      <IconButton
        icon="volume-high-outline"
        label="Choose audio output"
        caption="Audio"
        tone="dark"
        size={54}
        disabled={busy || !enabled || !onAudio}
        onPress={() => onAudio?.()}
      />
      <IconButton
        icon="call"
        label={options.endLabel ?? 'End call'}
        caption={options.endCaption ?? 'End'}
        tone="danger"
        size={54}
        busy={options.endBusy}
        onPress={options.onEnd}
      />
    </View>
  );
}

export function VideoCallConnecting({
  options,
  group = false,
}: {
  options: VideoCallOptions;
  group?: boolean;
}) {
  return (
    <VideoCallFrame
      title={options.title}
      status="Connecting video call…"
      onBack={options.onBack}
      controls={<VideoCallControls options={options} />}
    >
      <View style={styles.waiting}>
        <ChatAvatar name={options.title} group={group} size={104} dark />
        <ActivityIndicator color="#FFFFFF" accessibilityLabel="Connecting video call" />
      </View>
    </VideoCallFrame>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B141A' },
  stage: { flex: 1 },
  header: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: '#091115C9' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  identity: { flex: 1, gap: 5 },
  title: { color: '#FFFFFF', fontSize: 21, fontWeight: '600' },
  status: { color: '#D5E1E4', fontSize: 13 },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingTop: 12,
    backgroundColor: '#091115B8',
  },
  dock: {
    borderRadius: 30,
    backgroundColor: '#18272EEB',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FFFFFF20',
    padding: 14,
    marginBottom: 10,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  waiting: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 24 },
  error: {
    color: '#FFD5D8',
    backgroundColor: '#552D33',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    textAlign: 'center',
  },
});
