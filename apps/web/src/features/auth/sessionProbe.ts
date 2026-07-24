export const SESSION_HEARTBEAT_INTERVAL_MS = 5 * 60_000;

export function shouldProbeSession(input: {
  now: number;
  lastProbeAt: number;
  inFlight: boolean;
}) {
  return (
    !input.inFlight &&
    input.now - input.lastProbeAt >= SESSION_HEARTBEAT_INTERVAL_MS
  );
}
