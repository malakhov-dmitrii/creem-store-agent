import { describe, it, expect } from "vitest";
import { updateStateFromEvent, calculateMRR, countSubscriptions } from "../src/store-metrics.js";
import { emptyState } from "../src/store-state.js";
import type { CreemWebhookPayload } from "../src/types.js";

function makePayload(eventType: string, obj: Record<string, unknown> = {}): CreemWebhookPayload {
  return { eventType: eventType as any, id: `evt_${Date.now()}`, created_at: Date.now(), object: obj };
}

describe("updateStateFromEvent", () => {
  it("tracks checkout revenue", () => {
    const state = updateStateFromEvent(emptyState(), makePayload("checkout.completed", { amount: 4900 }));
    expect(state.todayRevenueCents).toBe(4900);
    expect(state.todayTransactionCount).toBe(1);
  });

  it("tracks subscription.active — increments active count and MRR", () => {
    const state = updateStateFromEvent(emptyState(), makePayload("subscription.active", {
      product: { price: 2900 },
    }));
    expect(state.subscriptions.active).toBe(1);
    expect(state.mrrCents).toBe(2900);
  });

  it("tracks subscription.canceled — decrements active, adds canceled, reduces MRR", () => {
    const initial = { ...emptyState(), subscriptions: { ...emptyState().subscriptions, active: 3 }, mrrCents: 8700 };
    const state = updateStateFromEvent(initial, makePayload("subscription.canceled", {
      product: { price: 2900 },
    }));
    expect(state.subscriptions.active).toBe(2);
    expect(state.subscriptions.canceled).toBe(1);
    expect(state.mrrCents).toBe(5800);
  });

  it("tracks subscription.past_due — moves from active to past_due", () => {
    const initial = { ...emptyState(), subscriptions: { ...emptyState().subscriptions, active: 2 } };
    const state = updateStateFromEvent(initial, makePayload("subscription.past_due"));
    expect(state.subscriptions.active).toBe(1);
    expect(state.subscriptions.past_due).toBe(1);
  });

  it("tracks subscription.paused — reduces MRR", () => {
    const initial = { ...emptyState(), subscriptions: { ...emptyState().subscriptions, active: 1 }, mrrCents: 2900 };
    const state = updateStateFromEvent(initial, makePayload("subscription.paused", {
      product: { price: 2900 },
    }));
    expect(state.subscriptions.paused).toBe(1);
    expect(state.subscriptions.active).toBe(0);
    expect(state.mrrCents).toBe(0);
  });

  it("tracks subscription.paid — adds revenue", () => {
    const state = updateStateFromEvent(emptyState(), makePayload("subscription.paid", { amount: 2900 }));
    expect(state.todayRevenueCents).toBe(2900);
    expect(state.todayTransactionCount).toBe(1);
  });

  it("tracks refund.created — subtracts revenue", () => {
    const initial = { ...emptyState(), todayRevenueCents: 5000 };
    const state = updateStateFromEvent(initial, makePayload("refund.created", { amount: 2900 }));
    expect(state.todayRevenueCents).toBe(2100);
  });

  it("tracks subscription.trialing", () => {
    const state = updateStateFromEvent(emptyState(), makePayload("subscription.trialing"));
    expect(state.subscriptions.trialing).toBe(1);
  });

  it("tracks subscription.scheduled_cancel", () => {
    const state = updateStateFromEvent(emptyState(), makePayload("subscription.scheduled_cancel"));
    expect(state.subscriptions.scheduled_cancel).toBe(1);
  });

  it("tracks subscription.expired", () => {
    const state = updateStateFromEvent(emptyState(), makePayload("subscription.expired"));
    expect(state.subscriptions.expired).toBe(1);
  });

  it("does not go below 0 for active count", () => {
    const state = updateStateFromEvent(emptyState(), makePayload("subscription.canceled", {
      product: { price: 2900 },
    }));
    expect(state.subscriptions.active).toBe(0);
    expect(state.mrrCents).toBe(0);
  });

  it("accumulates multiple events", () => {
    let state = emptyState();
    state = updateStateFromEvent(state, makePayload("checkout.completed", { amount: 2900 }));
    state = updateStateFromEvent(state, makePayload("checkout.completed", { amount: 900 }));
    state = updateStateFromEvent(state, makePayload("subscription.active", { product: { price: 2900 } }));
    state = updateStateFromEvent(state, makePayload("subscription.active", { product: { price: 900 } }));
    expect(state.todayRevenueCents).toBe(3800);
    expect(state.todayTransactionCount).toBe(2);
    expect(state.subscriptions.active).toBe(2);
    expect(state.mrrCents).toBe(3800);
  });
});

describe("calculateMRR", () => {
  it("sums prices of active and trialing subscriptions", () => {
    const subs = [
      { product: { price: 2900 }, status: "active" },
      { product: { price: 900 }, status: "active" },
      { product: { price: 4900 }, status: "trialing" },
      { product: { price: 9900 }, status: "canceled" },
    ];
    expect(calculateMRR(subs)).toBe(8700);
  });

  it("returns 0 for empty list", () => {
    expect(calculateMRR([])).toBe(0);
  });
});

describe("countSubscriptions", () => {
  it("counts subscriptions by status", () => {
    const subs = [
      { status: "active" }, { status: "active" }, { status: "active" },
      { status: "trialing" },
      { status: "past_due" }, { status: "past_due" },
      { status: "canceled" },
    ];
    const counts = countSubscriptions(subs);
    expect(counts.active).toBe(3);
    expect(counts.trialing).toBe(1);
    expect(counts.past_due).toBe(2);
    expect(counts.canceled).toBe(1);
    expect(counts.paused).toBe(0);
  });
});
