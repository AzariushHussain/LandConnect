import { ConnectionState, Room, Track } from 'livekit-client';
import { summarizeVideoStats, VideoStatsHistory } from './video-stats';

export function startVideoDiagnostics(
  room: Room,
  write: (streams: ReturnType<typeof summarizeVideoStats>['streams']) => void,
) {
  let alive = true,
    reading = false;
  let previous: VideoStatsHistory = new Map();
  async function sample() {
    if (!alive || reading || room.state !== ConnectionState.Connected) return;
    reading = true;
    try {
      const tracks = [
        room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack,
        ...[...room.remoteParticipants.values()].map(
          (peer) => peer.getTrackPublication(Track.Source.Camera)?.videoTrack,
        ),
      ];
      const reports = await Promise.allSettled(
        tracks.map(async (track) => track?.getRTCStatsReport()),
      );
      if (!alive) return;
      const combined = new Map<string, Record<string, unknown>>();
      for (const report of reports)
        if (report.status === 'fulfilled')
          report.value?.forEach((row) => {
            if (row && typeof row.id === 'string') combined.set(row.id, row);
          });
      const result = summarizeVideoStats(combined, previous);
      previous = result.next;
      if (result.streams.length) write(result.streams);
    } catch {
      // Some devices omit WebRTC counters; diagnostics must never interrupt a call.
    } finally {
      reading = false;
    }
  }
  const timer = setInterval(() => void sample(), 5000);
  void sample();
  return () => {
    alive = false;
    clearInterval(timer);
    previous.clear();
  };
}
