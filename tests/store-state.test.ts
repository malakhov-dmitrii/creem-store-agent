import { describe, it, expect } from "vitest";
import {
  emptyState,
  todayStr,
  takeDailySnapshot,
  addSnapshot,
  getYesterdaySnapshot,
  fmtMoney,
} from "../src/store-state.js";

describe("emptyState", () => {
  it("returns zeroed state", () => {
    const s = emptyState();
    expect(s.mrrCents).toBe(0);
    expect(s.customerCount).toBe(0);
    expect(s.subscriptions.active).toBe(0);
    expect(s.dailySnapshots).toEqual([]);
    expect(s.processedEventIds).toEqual([]);
  });
});

describe("todayStr", () => {
  it("returns YYYY-MM-DD format", () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("takeDailySnapshot", () => {
  it("captures current state as snapshot", () => {
    const state = {
      ...emptyState(),
      mrrCents: 5000,
      todayRevenueCents: 2900,
      todayTransactionCount: 3,
      customerCount: 10,
      subscriptions: { ...emptyState().subscriptions, active: 5, trialing: 2 },
    };
    const snap = takeDailySnapshot(state);
    expect(snap.mrrCents).toBe(5000);
    expect(snap.revenueCents).toBe(2900);
    expect(snap.transactionCount).toBe(3);
    expect(snap.customerCount).toBe(10);
    expect(snap.subscriptions.active).toBe(5);
  });
});

describe("addSnapshot", () => {
  it("adds snapshot and deduplicates by date", () => {
    const state = emptyState();
    const snap1 = { date: "2026-03-30", mrrCents: 1000, revenueCents: 500, transactionCount: 1, customerCount: 2, subscriptions: emptyState().subscriptions };
    const snap2 = { date: "2026-03-30", mrrCents: 2000, revenueCents: 600, transactionCount: 2, customerCount: 3, subscriptions: emptyState().subscriptions };

    const s1 = addSnapshot(state, snap1);
    expect(s1.dailySnapshots).toHaveLength(1);

    const s2 = addSnapshot(s1, snap2);
    expect(s2.dailySnapshots).toHaveLength(1);
    expect(s2.dailySnapshots[0].mrrCents).toBe(2000);
  });

  it("keeps max 90 days", () => {
    let state = emptyState();
    for (let i = 0; i < 100; i++) {
      const date = `2026-01-${String(i + 1).padStart(2, "0")}`;
      state = addSnapshot(state, { date, mrrCents: i * 100, revenueCents: 0, transactionCount: 0, customerCount: 0, subscriptions: emptyState().subscriptions });
    }
    expect(state.dailySnapshots.length).toBeLessThanOrEqual(90);
  });
});

describe("getYesterdaySnapshot", () => {
  it("returns null when no snapshots", () => {
    expect(getYesterdaySnapshot(emptyState())).toBeNull();
  });

  it("returns yesterday's snapshot when present", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().slice(0, 10);

    const state = addSnapshot(emptyState(), {
      date: yStr, mrrCents: 3000, revenueCents: 0, transactionCount: 0,
      customerCount: 0, subscriptions: emptyState().subscriptions,
    });
    const snap = getYesterdaySnapshot(state);
    expect(snap).not.toBeNull();
    expect(snap!.mrrCents).toBe(3000);
  });
});

describe("fmtMoney", () => {
  it("formats cents to dollars", () => {
    expect(fmtMoney(2900)).toBe("$29.00");
    expect(fmtMoney(0)).toBe("$0.00");
    expect(fmtMoney(99)).toBe("$0.99");
  });
});
