import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import {
  VideoTrack,
  TrackReference,
  useIsSpeaking,
  useTrackMutedIndicator,
} from '@livekit/react-native';
import { Participant, Track } from 'livekit-client';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatAvatar } from '../chat/ChatAvatar';
import { videoGrid } from './video-layout';

function ParticipantVideo({
  participant,
  track,
  name,
  mirror = false,
  floating = false,
  visible = true,
}: {
  participant: Participant;
  track?: TrackReference;
  name: string;
  mirror?: boolean;
  floating?: boolean;
  visible?: boolean;
}) {
  const speaking = useIsSpeaking(participant);
  const { isMuted: cameraOff } = useTrackMutedIndicator({
    participant,
    source: Track.Source.Camera,
  });
  const { isMuted: micOff } = useTrackMutedIndicator({
    participant,
    source: Track.Source.Microphone,
  });
  const hasVideo = visible && !!track && !cameraOff && !track.publication.isMuted;
  return (
    <View style={[styles.tile, speaking && styles.speaking]}>
      {hasVideo ? (
        <VideoTrack
          trackRef={track}
          mirror={mirror}
          objectFit="cover"
          zOrder={floating ? 1 : 0}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={styles.fallback}>
          <ChatAvatar name={name} size={floating ? 42 : 72} dark />
          {!floating && (
            <Text style={styles.cameraStatus}>
              {cameraOff ? 'Camera off' : 'Connecting video…'}
            </Text>
          )}
        </View>
      )}
      <View style={styles.tileLabel}>
        <Text numberOfLines={1} style={styles.label}>
          {name}
        </Text>
        {micOff && (
          <Ionicons
            accessibilityLabel="Microphone muted"
            name="mic-off"
            color="#FFFFFF"
            size={14}
          />
        )}
      </View>
    </View>
  );
}

export function CallVideoStage({
  group,
  local,
  peers,
  tracks,
  names,
  frontFacing,
}: {
  group: boolean;
  local: Participant;
  peers: Participant[];
  tracks: TrackReference[];
  names: Record<string, string>;
  frontFacing: boolean;
}) {
  const insets = useSafeAreaInsets(),
    window = useWindowDimensions();
  const [size, setSize] = useState({ width: 0, height: 0 }),
    [page, setPage] = useState(0);
  const list = useRef<FlatList<Participant[]>>(null);
  const byId = new Map(tracks.map((track) => [track.participant.identity, track]));
  const people = [local, ...peers];
  const pages = Array.from({ length: Math.ceil(people.length / 4) }, (_, index) =>
    people.slice(index * 4, index * 4 + 4),
  );
  if (page >= pages.length) setPage(pages.length - 1);
  useEffect(() => {
    if (size.width) list.current?.scrollToOffset({ offset: page * size.width, animated: false });
  }, [page, size.width]);
  if (!group) {
    const peer = peers[0];
    const previewHeight = Math.min(
      164,
      Math.max(70, window.height - insets.top - insets.bottom - 230),
    );
    return (
      <View style={styles.direct}>
        {peer ? (
          <ParticipantVideo
            participant={peer}
            track={byId.get(peer.identity)}
            name={names[peer.identity] ?? 'Participant'}
          />
        ) : (
          <View style={styles.fallback}>
            <Ionicons name="videocam-outline" color="#7D939F" size={54} />
            <Text style={styles.waiting}>Waiting for the other person…</Text>
          </View>
        )}
        <View
          style={[
            styles.preview,
            { top: insets.top + 88, width: previewHeight * 0.7, height: previewHeight },
          ]}
        >
          <ParticipantVideo
            participant={local}
            track={byId.get(local.identity)}
            name="You"
            mirror={frontFacing}
            floating
          />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.group}>
      <View
        style={styles.grid}
        onLayout={({ nativeEvent }) =>
          setSize({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })
        }
      >
        {size.width > 0 && size.height > 0 && (
          <FlatList
            ref={list}
            data={pages}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(_, index) => String(index)}
            initialNumToRender={1}
            maxToRenderPerBatch={1}
            windowSize={3}
            extraData={page}
            getItemLayout={(_, index) => ({
              index,
              length: size.width,
              offset: index * size.width,
            })}
            onMomentumScrollEnd={(event) =>
              setPage(
                Math.max(
                  0,
                  Math.min(
                    pages.length - 1,
                    Math.round(event.nativeEvent.contentOffset.x / size.width),
                  ),
                ),
              )
            }
            renderItem={({ item, index: pageIndex }) => {
              const frames = videoGrid(item.length, size.width, size.height);
              return (
                <View style={size}>
                  {item.map((participant, index) => (
                    <View key={participant.identity} style={[styles.gridCell, frames[index]]}>
                      <ParticipantVideo
                        visible={pageIndex === page}
                        participant={participant}
                        track={byId.get(participant.identity)}
                        name={
                          participant.isLocal
                            ? 'You'
                            : (names[participant.identity] ?? 'Participant')
                        }
                        mirror={participant.isLocal && frontFacing}
                      />
                    </View>
                  ))}
                </View>
              );
            }}
          />
        )}
      </View>
      {pages.length > 1 && (
        <View style={styles.pages}>
          <Text accessibilityLiveRegion="polite" style={styles.pageText}>
            Swipe for more · {page + 1} / {pages.length}
          </Text>
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  direct: { flex: 1, backgroundColor: '#0B141A' },
  tile: {
    flex: 1,
    backgroundColor: '#192C35',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  speaking: { borderColor: '#4FD5A3' },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 15 },
  cameraStatus: { color: '#B8C9D2', fontSize: 13 },
  waiting: { color: '#C9D8DE', fontSize: 16, textAlign: 'center', padding: 24 },
  tileLabel: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#08131AC4',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  label: { color: '#FFFFFF', fontSize: 13, fontWeight: '500', flexShrink: 1 },
  preview: {
    position: 'absolute',
    right: 16,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#FFFFFF66',
    elevation: 8,
    zIndex: 2,
  },
  group: { flex: 1, paddingHorizontal: 6, gap: 8 },
  grid: { flex: 1 },
  gridCell: { position: 'absolute', overflow: 'hidden', borderRadius: 18 },
  pages: { alignItems: 'center', paddingBottom: 8 },
  pageText: { color: '#BBD0D9', fontSize: 12 },
});
