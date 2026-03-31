import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface SubscriptionCounts {
  active: number;
  trialing: number;
  past_due: number;
  paused: number;
  canceled: number;
  expired: number;
  scheduled_cancel: number;
}

export interface DailySnapshot {
  date: string;
  mrrCents: number;
  revenueCents: number;
  transactionCount: number;
  customerCount: number;
  subscriptions: SubscriptionCounts;
}

export interface StoreState {
  lastUpdated: string | null;
  mrrCents: number;
  customerCount: number;
  subscriptions: SubscriptionCounts;
  todayRevenueCents: number;
  todayTransactionCount: number;
  processedEventIds: string[];
  dailySnapshots: DailySnapshot[];
}

const EMPTY_SUBS: SubscriptionCounts = {
  active: 0, trialing: 0, past_due: 0, paused: 0,
  canceled: 0, expired: 0, scheduled_cancel: 0,
};

export function emptyState(): StoreState {
  return {
    lastUpdated: null,
    mrrCents: 0,
    customerCount: 0,
    subscriptions: { ...EMPTY_SUBS },
    todayRevenueCents: 0,
    todayTransactionCount: 0,
    processedEventIds: [],
    dailySnapshots: [],
  };
}

export function loadState(path: string): StoreState {
  try {
    const raw = readFileSync(path, "utf-8");
    return { ...emptyState(), ...JSON.parse(raw) };
  } catch {
    return emptyState();
  }
}

export function saveState(path: string, state: StoreState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function takeDailySnapshot(state: StoreState): DailySnapshot {
  return {
    date: todayStr(),
    mrrCents: state.mrrCents,
    revenueCents: state.todayRevenueCents,
    transactionCount: state.todayTransactionCount,
    customerCount: state.customerCount,
    subscriptions: { ...state.subscriptions },
  };
}

export function addSnapshot(state: StoreState, snapshot: DailySnapshot): StoreState {
  const existing = state.dailySnapshots.filter(s => s.date !== snapshot.date);
  existing.push(snapshot);
  // Keep last 90 days
  const cutoff = existing.length > 90 ? existing.length - 90 : 0;
  return {
    ...state,
    dailySnapshots: existing.slice(cutoff),
  };
}

export function getYesterdaySnapshot(state: StoreState): DailySnapshot | null {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10);
  return state.dailySnapshots.find(s => s.date === yStr) ?? null;
}

export function fmtMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
