import type { CreemWebhookPayload } from "./types.js";
import type { StoreState, SubscriptionCounts } from "./store-state.js";
import { todayStr } from "./store-state.js";

/**
 * Update store state from a webhook event.
 * Returns a new state object (immutable pattern for testability).
 */
export function updateStateFromEvent(
  state: StoreState,
  payload: CreemWebhookPayload,
): StoreState {
  const obj = payload.object as Record<string, unknown>;
  const newState = {
    ...state,
    lastUpdated: new Date().toISOString(),
    subscriptions: { ...state.subscriptions },
  };

  // Reset daily counters if date changed
  const today = todayStr();
  const lastDate = state.lastUpdated?.slice(0, 10);
  if (lastDate && lastDate !== today) {
    newState.todayRevenueCents = 0;
    newState.todayTransactionCount = 0;
  }

  switch (payload.eventType) {
    case "checkout.completed": {
      const amount = typeof obj.amount === "number" ? obj.amount : 0;
      newState.todayRevenueCents += amount;
      newState.todayTransactionCount += 1;
      break;
    }

    case "subscription.active": {
      newState.subscriptions.active += 1;
      const price = getProductPrice(obj);
      if (price > 0) newState.mrrCents += price;
      break;
    }

    case "subscription.paid": {
      const amount = typeof obj.amount === "number" ? obj.amount : 0;
      newState.todayRevenueCents += amount;
      newState.todayTransactionCount += 1;
      break;
    }

    case "subscription.canceled": {
      newState.subscriptions.canceled += 1;
      if (newState.subscriptions.active > 0) newState.subscriptions.active -= 1;
      const price = getProductPrice(obj);
      if (price > 0) newState.mrrCents = Math.max(0, newState.mrrCents - price);
      break;
    }

    case "subscription.scheduled_cancel": {
      newState.subscriptions.scheduled_cancel += 1;
      break;
    }

    case "subscription.past_due": {
      newState.subscriptions.past_due += 1;
      if (newState.subscriptions.active > 0) newState.subscriptions.active -= 1;
      break;
    }

    case "subscription.paused": {
      newState.subscriptions.paused += 1;
      if (newState.subscriptions.active > 0) newState.subscriptions.active -= 1;
      const price = getProductPrice(obj);
      if (price > 0) newState.mrrCents = Math.max(0, newState.mrrCents - price);
      break;
    }

    case "subscription.expired": {
      newState.subscriptions.expired += 1;
      break;
    }

    case "subscription.trialing": {
      newState.subscriptions.trialing += 1;
      break;
    }

    case "subscription.update":
      break;

    case "subscription.unpaid":
      break;

    case "refund.created": {
      const amount = typeof obj.amount === "number" ? obj.amount : 0;
      newState.todayRevenueCents -= amount;
      break;
    }

    case "dispute.created":
      break;
  }

  return newState;
}

function getProductPrice(obj: Record<string, unknown>): number {
  const product = obj.product as Record<string, unknown> | undefined;
  if (product && typeof product.price === "number") return product.price;
  return typeof obj.price === "number" ? obj.price : 0;
}

/**
 * Calculate MRR from Creem SDK subscription search results.
 */
export function calculateMRR(
  subscriptions: Array<{ product?: { price?: number }; status?: string }>,
): number {
  return subscriptions
    .filter(s => s.status === "active" || s.status === "trialing")
    .reduce((sum, s) => sum + (s.product?.price ?? 0), 0);
}

/**
 * Count subscriptions by status from SDK search results.
 */
export function countSubscriptions(
  subscriptions: Array<{ status?: string }>,
): SubscriptionCounts {
  const counts: SubscriptionCounts = {
    active: 0, trialing: 0, past_due: 0, paused: 0,
    canceled: 0, expired: 0, scheduled_cancel: 0,
  };
  for (const sub of subscriptions) {
    const status = sub.status as keyof SubscriptionCounts | undefined;
    if (status && status in counts) counts[status] += 1;
  }
  return counts;
}
