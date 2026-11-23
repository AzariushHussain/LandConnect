type Row = Record<string, unknown>;
type Counters = {
  time: number | null;
  bytes: number | null;
  frames: number | null;
  packets: number | null;
  lost: number | null;
  dropped: number | null;
  processing: number | null;
  processed: number | null;
  buffer: number | null;
  emitted: number | null;
};
export type VideoStatsHistory = Map<string, Counters>;
const number = (row: Row | undefined, key: string): number | null =>
  typeof row?.[key] === 'number' && Number.isFinite(row[key]) ? (row[key] as number) : null;
const delta = (value: number | null, previous: number | null | undefined) =>
  value !== null && previous != null && value >= previous ? value - previous : null;
const rounded = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);
const perSecond = (value: number | null, elapsed: number | null) =>
  value !== null && elapsed !== null && elapsed > 0 ? (value * 1000) / elapsed : null;

export function summarizeVideoStats(report: ReadonlyMap<string, Row>, previous: VideoStatsHistory) {
  const next: VideoStatsHistory = new Map();
  const streams = [];
  for (const [id, row] of report) {
    if (row.type !== 'outbound-rtp' && row.type !== 'inbound-rtp') continue;
    const codec = report.get(String(row.codecId));
    const mime = typeof codec?.mimeType === 'string' ? codec.mimeType : '';
    if (row.kind !== 'video' && row.mediaType !== 'video' && !mime.startsWith('video/')) continue;
    if (/\/(rtx|red|ulpfec|flexfec)/i.test(mime)) continue;
    const sending = row.type === 'outbound-rtp';
    const remote = report.get(String(row.remoteId));
    const transport = report.get(String(row.transportId));
    const pair = report.get(String(transport?.selectedCandidatePairId));
    const current: Counters = {
      time: number(row, 'timestamp'),
      bytes: number(row, sending ? 'bytesSent' : 'bytesReceived'),
      frames: number(row, sending ? 'framesSent' : 'framesDecoded'),
      packets: number(row, sending ? 'packetsSent' : 'packetsReceived'),
      lost: number(sending ? remote : row, 'packetsLost'),
      dropped: number(row, 'framesDropped'),
      processing: number(row, sending ? 'totalEncodeTime' : 'totalDecodeTime'),
      processed: number(row, sending ? 'framesEncoded' : 'framesDecoded'),
      buffer: number(row, 'jitterBufferDelay'),
      emitted: number(row, 'jitterBufferEmittedCount'),
    };
    const old = previous.get(id),
      elapsed = delta(current.time, old?.time);
    const byteRate = perSecond(delta(current.bytes, old?.bytes), elapsed);
    const packets = delta(current.packets, old?.packets),
      lost = delta(current.lost, old?.lost);
    const totalPackets = packets !== null && lost !== null ? packets + (sending ? 0 : lost) : null;
    const processing = delta(current.processing, old?.processing),
      processed = delta(current.processed, old?.processed);
    const buffer = delta(current.buffer, old?.buffer),
      emitted = delta(current.emitted, old?.emitted);
    const rtt = number(remote, 'roundTripTime') ?? number(pair, 'currentRoundTripTime');
    const jitter = number(sending ? remote : row, 'jitter');
    const reason = ['none', 'cpu', 'bandwidth', 'other'].includes(
      String(row.qualityLimitationReason),
    )
      ? String(row.qualityLimitationReason)
      : null;
    streams.push({
      direction: sending ? 'send' : 'receive',
      codec: /^video\/[a-z0-9.-]{1,24}$/i.test(mime) ? mime : null,
      width: number(row, 'frameWidth'),
      height: number(row, 'frameHeight'),
      fps: rounded(perSecond(delta(current.frames, old?.frames), elapsed)),
      kbps: rounded(byteRate === null ? null : (byteRate * 8) / 1000),
      lossPct: rounded(totalPackets && lost !== null ? (lost / totalPackets) * 100 : null),
      droppedFps: rounded(perSecond(delta(current.dropped, old?.dropped), elapsed)),
      jitterMs: rounded(jitter === null ? null : jitter * 1000),
      rttMs: rounded(rtt === null ? null : rtt * 1000),
      processingMs: rounded(
        processing !== null && processed ? (processing / processed) * 1000 : null,
      ),
      jitterBufferMs: rounded(buffer !== null && emitted ? (buffer / emitted) * 1000 : null),
      qualityLimit: reason,
    });
    next.set(id, current);
  }
  return { streams, next };
}
