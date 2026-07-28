/**
 * Worker scheduling mode (§5.4 delivery, adapted to Vercel Hobby).
 *
 * THE CONSTRAINT THIS EXISTS FOR. Vercel reads cron schedules from vercel.json
 * at deploy time, so no environment variable can change a schedule — and Hobby
 * caps crons at once per day regardless. A minute-level cron simply will not run
 * there.
 *
 * So the schedule stays fixed (daily, the most Hobby allows) and this decides
 * what each hit actually DOES. Flipping the switch changes behaviour without
 * touching vercel.json.
 *
 * Worth being clear about what "continuous" can and cannot mean: a serverless
 * function has no background process, so nothing here runs between invocations.
 * What makes delivery feel live on Hobby is the SUPABASE DATABASE WEBHOOK on
 * profile_change_events — event-driven, free, unlimited, and completely outside
 * the cron limit — plus the opportunistic trigger in trigger.ts that drains a
 * profile's own events right after it edits. The cron is the safety net for
 * anything both of those missed.
 */

export type WorkerMode = "continuous" | "weekly" | "off";

export function workerMode(): WorkerMode {
  const raw = (process.env.WORKER_MODE ?? "continuous").trim().toLowerCase();
  if (raw === "weekly") return "weekly";
  if (raw === "off" || raw === "false" || raw === "0") return "off";
  // Default to continuous: a misconfigured value silently not delivering
  // notifications is a much worse failure than one that delivers them.
  return "continuous";
}

/** 0 = Sunday. Defaults to Monday. */
function weeklyDay(): number {
  const raw = Number.parseInt(process.env.WORKER_WEEKLY_DAY ?? "1", 10);
  return Number.isInteger(raw) && raw >= 0 && raw <= 6 ? raw : 1;
}

export type ScheduleDecision = {
  run: boolean;
  mode: WorkerMode;
  reason: string;
};

/**
 * Whether this invocation should do work.
 *
 * In weekly mode the DAY is checked here and the TIME comes from the cron
 * expression in vercel.json — the daily cron fires, and six days out of seven
 * this returns false and the handler exits in milliseconds. Checking the hour
 * too would be fragile: Hobby cron timing is best-effort and can drift by up to
 * an hour, so an exact-hour match would silently skip some weeks entirely.
 *
 * `force` covers the manual/webhook path: a Database Webhook firing because an
 * event was just written should always be honoured, since it only fires when
 * there is genuinely something to deliver.
 */
export function shouldRun(
  { force = false, now = new Date() }: { force?: boolean; now?: Date } = {},
): ScheduleDecision {
  const mode = workerMode();

  if (mode === "off") {
    // `off` beats force — it is the "stop everything" switch, and a switch that
    // some callers can override is not a switch.
    return { run: false, mode, reason: "WORKER_MODE=off" };
  }

  if (force) {
    return { run: true, mode, reason: "forced (webhook or manual run)" };
  }

  if (mode === "weekly") {
    const today = now.getUTCDay();
    const target = weeklyDay();
    if (today !== target) {
      return {
        run: false,
        mode,
        reason: `weekly mode: today is day ${today} UTC, configured day is ${target}`,
      };
    }
    return { run: true, mode, reason: `weekly mode: matched day ${target}` };
  }

  return { run: true, mode, reason: "continuous mode" };
}

/**
 * How long a single invocation may keep draining.
 *
 * Bounded well under the route's maxDuration so the handler can always return a
 * summary rather than being killed mid-run — a timeout produces no response and
 * no log line, which looks identical to the cron never firing.
 */
export function timeBudgetMs(): number {
  return workerMode() === "continuous" ? 45_000 : 20_000;
}
