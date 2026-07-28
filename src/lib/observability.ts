/**
 * Structured logging (§9).
 *
 * One JSON object per line, because that is what makes Vercel's log search and
 * any log drain able to answer the questions §9 actually asks — scan
 * success/failure rate, notification delivery success, RPC error rate. A
 * free-text `console.log` can be read by a human and by nothing else.
 *
 * This is not an APM and does not pretend to be. Latency histograms, alerting
 * and dashboards need real tooling; what this gives you is the event stream to
 * build them from, at no dependency cost.
 */

type Level = "info" | "warn" | "error";

export type EventFields = Record<string, string | number | boolean | null | undefined>;

function emit(level: Level, event: string, fields: EventFields) {
  const line = JSON.stringify({
    level,
    event,
    ts: new Date().toISOString(),
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields: EventFields = {}) => emit("info", event, fields),
  warn: (event: string, fields: EventFields = {}) => emit("warn", event, fields),
  error: (event: string, fields: EventFields = {}) => emit("error", event, fields),
};

/**
 * Times an operation and logs the outcome either way.
 *
 * Never swallows the error — it re-throws after logging, so this can be wrapped
 * around existing code without changing control flow.
 */
export async function timed<T>(
  event: string,
  fields: EventFields,
  operation: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await operation();
    log.info(event, { ...fields, ok: true, ms: Date.now() - started });
    return result;
  } catch (cause) {
    log.error(event, {
      ...fields,
      ok: false,
      ms: Date.now() - started,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    throw cause;
  }
}
