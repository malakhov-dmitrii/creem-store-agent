import { describe, it, expect } from "vitest";
import { formatStatusReport, formatRevenueReport, formatDailyDigest } from "../src/commands.js";
import { emptyState, addSnapshot } from "../src/store-state.js";
import type { StoreState } from "../src/store-state.js";

function stateWith(overrides: Partial<StoreState>): StoreState {
  return { ...emptyState(), ...overrides };
}

describe("formatStatusReport", () => {
  it("shows health score and MRR", () => {
    const state = stateWith({
      mrrCents: 12500,
      customerCount: 15,
      subscriptions: { ...emptyState().subscriptions, active: 10, trialing: 2, past_due: 1 },
      lastUpdated: "2026-03-31T10:00:00Z",
    });
    const report = formatStatusReport(state);
    expect(report).toContain("$125.00");
    expect(report).toContain("Health Score");
    expect(report).toContain("active: 10");
    expect(report).toContain("trialing: 2");
    expect(report).toContain("past due");
  });

  it("shows 100% health for empty store", () => {
    const report = formatStatusReport(emptyState());
    expect(report).toContain("100%");
  });

  it("shows warning for past_due subscriptions", () => {
    const state = stateWith({
      subscriptions: { ...emptyState().subscriptions, active: 5, past_due: 3 },
    });
    const report = formatStatusReport(state);
    expect(report).toContain("3 past due");
    expect(report).toContain("revenue at risk");
  });
});

describe("formatRevenueReport", () => {
  it("shows MRR and today's revenue", () => {
    const state = stateWith({
      mrrCents: 8700,
      todayRevenueCents: 2900,
      todayTransactionCount: 3,
      subscriptions: { ...emptyState().subscriptions, active: 3 },
    });
    const report = formatRevenueReport(state);
    expect(report).toContain("$87.00");
    expect(report).toContain("$29.00");
    expect(report).toContain("3 transactions");
  });

  it("shows MRR delta when yesterday snapshot exists", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().slice(0, 10);

    let state = stateWith({ mrrCents: 8700 });
    state = addSnapshot(state, {
      date: yStr, mrrCents: 5800, revenueCents: 2900, transactionCount: 1,
      customerCount: 5, subscriptions: emptyState().subscriptions,
    });
    const report = formatRevenueReport(state);
    expect(report).toContain("↑");
    expect(report).toContain("$29.00"); // delta
  });

  it("shows churn risk when past_due or scheduled_cancel", () => {
    const state = stateWith({
      subscriptions: { ...emptyState().subscriptions, active: 5, past_due: 2, scheduled_cancel: 1 },
    });
    const report = formatRevenueReport(state);
    expect(report).toContain("Churn risk: 3");
    expect(report).toContain("2 past due");
    expect(report).toContain("1 scheduled to cancel");
  });

  it("shows 7-day trend when snapshots available", () => {
    let state = stateWith({ mrrCents: 10000 });
    for (let i = 7; i >= 1; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      state = addSnapshot(state, {
        date: d.toISOString().slice(0, 10), mrrCents: 5000 + i * 500,
        revenueCents: 1000, transactionCount: 1, customerCount: 5,
        subscriptions: emptyState().subscriptions,
      });
    }
    const report = formatRevenueReport(state);
    expect(report).toContain("7-day trend");
  });
});

describe("formatDailyDigest", () => {
  it("includes greeting and MRR", () => {
    const state = stateWith({
      mrrCents: 12500,
      subscriptions: { ...emptyState().subscriptions, active: 10 },
    });
    const digest = formatDailyDigest(state);
    expect(digest).toContain("Good morning");
    expect(digest).toContain("$125.00");
  });

  it("shows all clear when no issues", () => {
    const state = stateWith({
      subscriptions: { ...emptyState().subscriptions, active: 5 },
    });
    const digest = formatDailyDigest(state);
    expect(digest).toContain("All clear");
  });

  it("shows warnings for past_due and scheduled_cancel", () => {
    const state = stateWith({
      subscriptions: { ...emptyState().subscriptions, active: 5, past_due: 2, scheduled_cancel: 1 },
    });
    const digest = formatDailyDigest(state);
    expect(digest).toContain("Needs attention");
    expect(digest).toContain("2 past due");
    expect(digest).toContain("1 pending cancellation");
  });

  it("shows MRR drop alert", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().slice(0, 10);

    let state = stateWith({ mrrCents: 5000 });
    state = addSnapshot(state, {
      date: yStr, mrrCents: 7000, revenueCents: 0, transactionCount: 0,
      customerCount: 0, subscriptions: emptyState().subscriptions,
    });
    const digest = formatDailyDigest(state);
    expect(digest).toContain("MRR dropped");
  });

  it("shows yesterday revenue when snapshot available", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().slice(0, 10);

    let state = stateWith({ mrrCents: 5000 });
    state = addSnapshot(state, {
      date: yStr, mrrCents: 5000, revenueCents: 4900, transactionCount: 3,
      customerCount: 5, subscriptions: emptyState().subscriptions,
    });
    const digest = formatDailyDigest(state);
    expect(digest).toContain("Yesterday: $49.00 (3 tx)");
  });
});
