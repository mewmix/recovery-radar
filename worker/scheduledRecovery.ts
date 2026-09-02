import { getShovelsUsage, searchShovelsPermits, type PublicPermit } from "./providers/shovels";

export interface KVNamespaceBinding {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}

export interface RecoveryEnv {
  RECOVERY_STATE: KVNamespaceBinding;
  SHOVELS_API_KEY?: string;
}

type RecoveryJob = {
  slug: string;
  geoId: string;
  recoveryStart: string;
  seedCheckedThrough: string;
  maxRecordsPerRun: number;
  reserveCredits: number;
};

type PendingWindow = {
  from: string;
  to: string;
  cursor: string;
};

export type RecoverySyncState = {
  schemaVersion: 1;
  slug: string;
  geoId: string;
  checkedThrough: string;
  pendingWindow: PendingWindow | null;
  permits: PublicPermit[];
  updatedAt: string | null;
  lastRun: {
    at: string;
    status: "updated" | "no_records" | "up_to_date" | "credit_blocked" | "usage_unverified" | "missing_secret";
    windowFrom?: string;
    windowTo?: string;
    returned?: number;
    consumed?: number;
    creditsRemainingBefore?: number;
    creditsRemainingAfter?: number | null;
  } | null;
};

export const RECOVERY_JOBS: RecoveryJob[] = [
  {
    slug: "plaskett-2026",
    geoId: "93920",
    recoveryStart: "2026-08-26",
    // Manually queried on 2026-09-02: zero matching records through 2026-09-01.
    seedCheckedThrough: "2026-09-01",
    maxRecordsPerRun: 5,
    reserveCredits: 100,
  },
];

function stateKey(slug: string): string {
  return `recovery:${slug}`;
}

function dateOnly(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function compareDates(a: string, b: string): number {
  return a.localeCompare(b);
}

function emptyState(job: RecoveryJob): RecoverySyncState {
  return {
    schemaVersion: 1,
    slug: job.slug,
    geoId: job.geoId,
    checkedThrough: job.seedCheckedThrough,
    pendingWindow: null,
    permits: [],
    updatedAt: null,
    lastRun: null,
  };
}

function isRecoveryState(value: unknown, job: RecoveryJob): value is RecoverySyncState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<RecoverySyncState>;
  return candidate.schemaVersion === 1
    && candidate.slug === job.slug
    && candidate.geoId === job.geoId
    && typeof candidate.checkedThrough === "string"
    && Array.isArray(candidate.permits);
}

export async function getRecoveryState(env: RecoveryEnv, slug: string): Promise<RecoverySyncState | null> {
  const job = RECOVERY_JOBS.find((candidate) => candidate.slug === slug);
  if (!job) return null;
  const value = await env.RECOVERY_STATE.get(stateKey(slug), "json");
  return isRecoveryState(value, job) ? value : null;
}

async function saveState(env: RecoveryEnv, state: RecoverySyncState): Promise<void> {
  await env.RECOVERY_STATE.put(stateKey(state.slug), JSON.stringify(state));
}

function permitKey(permit: PublicPermit): string {
  if (permit.id) return `id:${permit.id}`;
  return [
    "fallback",
    permit.dates.file ?? "",
    permit.location.lat ?? "",
    permit.location.lng ?? "",
    permit.description ?? "",
  ].join(":");
}

function mergePermits(existing: PublicPermit[], incoming: PublicPermit[]): PublicPermit[] {
  const byId = new Map(existing.map((permit) => [permitKey(permit), permit]));
  for (const permit of incoming) byId.set(permitKey(permit), permit);
  return [...byId.values()].sort((a, b) => (b.dates.file ?? "").localeCompare(a.dates.file ?? ""));
}

async function syncJob(env: RecoveryEnv, job: RecoveryJob, scheduledTime: number): Promise<RecoverySyncState> {
  const stored = await env.RECOVERY_STATE.get(stateKey(job.slug), "json");
  const state = isRecoveryState(stored, job) ? stored : emptyState(job);
  const runAt = new Date(scheduledTime).toISOString();

  if (!env.SHOVELS_API_KEY) {
    state.lastRun = { at: runAt, status: "missing_secret" };
    await saveState(env, state);
    console.warn(`[recovery-sync] ${job.slug}: SHOVELS_API_KEY missing; no query sent`);
    return state;
  }

  const usage = await getShovelsUsage(env.SHOVELS_API_KEY);
  if (usage.remaining == null) {
    state.lastRun = { at: runAt, status: "usage_unverified" };
    await saveState(env, state);
    console.warn(`[recovery-sync] ${job.slug}: credit balance unavailable; no query sent`);
    return state;
  }

  const spendable = Math.max(0, usage.remaining - job.reserveCredits);
  if (spendable < 1) {
    state.lastRun = {
      at: runAt,
      status: "credit_blocked",
      creditsRemainingBefore: usage.remaining,
    };
    await saveState(env, state);
    console.warn(`[recovery-sync] ${job.slug}: ${usage.remaining} credits remain; ${job.reserveCredits} reserved`);
    return state;
  }

  const yesterday = addDays(dateOnly(scheduledTime), -1);
  let windowFrom: string;
  let windowTo: string;
  let cursor: string | null = null;

  if (state.pendingWindow) {
    windowFrom = state.pendingWindow.from;
    windowTo = state.pendingWindow.to;
    cursor = state.pendingWindow.cursor;
  } else {
    windowFrom = addDays(state.checkedThrough, 1);
    windowTo = yesterday;
  }

  if (compareDates(windowFrom, windowTo) > 0) {
    state.lastRun = {
      at: runAt,
      status: "up_to_date",
      creditsRemainingBefore: usage.remaining,
    };
    await saveState(env, state);
    console.log(`[recovery-sync] ${job.slug}: up to date through ${state.checkedThrough}; no query sent`);
    return state;
  }

  const size = Math.min(job.maxRecordsPerRun, spendable);
  const result = await searchShovelsPermits(env.SHOVELS_API_KEY, {
    geoId: job.geoId,
    permitFrom: windowFrom,
    permitTo: windowTo,
    size,
    cursor,
  });

  state.permits = mergePermits(state.permits, result.permits);
  state.updatedAt = runAt;

  if (result.nextCursor) {
    state.pendingWindow = {
      from: windowFrom,
      to: windowTo,
      cursor: result.nextCursor,
    };
  } else {
    state.pendingWindow = null;
    state.checkedThrough = windowTo;
  }

  state.lastRun = {
    at: runAt,
    status: result.permits.length ? "updated" : "no_records",
    windowFrom,
    windowTo,
    returned: result.permits.length,
    consumed: result.consumed,
    creditsRemainingBefore: usage.remaining,
    creditsRemainingAfter: result.remaining,
  };

  await saveState(env, state);
  console.log(JSON.stringify({
    event: "recovery-sync",
    slug: job.slug,
    windowFrom,
    windowTo,
    returned: result.permits.length,
    consumed: result.consumed,
    checkedThrough: state.checkedThrough,
    pending: Boolean(state.pendingWindow),
    creditsRemainingBefore: usage.remaining,
    creditsRemainingAfter: result.remaining,
  }));
  return state;
}

export async function runScheduledRecoverySync(env: RecoveryEnv, scheduledTime: number): Promise<void> {
  for (const job of RECOVERY_JOBS) {
    try {
      await syncJob(env, job, scheduledTime);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[recovery-sync] ${job.slug}: ${message}`);
    }
  }
}

export function recoveryDatasetFromState(state: RecoverySyncState): Record<string, unknown> {
  const job = RECOVERY_JOBS.find((candidate) => candidate.slug === state.slug);
  const observedThrough = state.pendingWindow?.to ?? state.checkedThrough;
  return {
    updatedAt: state.updatedAt,
    query: {
      geoId: state.geoId,
      permitFrom: job?.recoveryStart ?? null,
      permitTo: observedThrough,
      tags: [],
      requestedSize: job?.maxRecordsPerRun ?? null,
    },
    permitCount: state.permits.length,
    nextCursor: state.pendingWindow?.cursor ?? null,
    permits: state.permits,
    sync: {
      mode: "scheduled_incremental",
      completeThrough: state.checkedThrough,
      pendingWindow: state.pendingWindow,
      lastRun: state.lastRun,
      maxRecordsPerRun: job?.maxRecordsPerRun ?? null,
      reserveCredits: job?.reserveCredits ?? null,
    },
  };
}
