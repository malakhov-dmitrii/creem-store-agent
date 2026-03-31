import type { StoreState } from "./store-state.js";
import { fmtMoney, getYesterdaySnapshot } from "./store-state.js";

function statusEmoji(status: string): string {
  const map: Record<string, string> = {
    active: "✅", trialing: "🔬", past_due: "🚨", paused: "⏸️",
    canceled: "❌", expired: "💀", scheduled_cancel: "⏰",
  };
  return map[status] ?? "❓";
}

/**
 * /creem-status — Health check with subscription breakdown
 */
export function formatStatusReport(state: StoreState): string {
  const subs = state.subscriptions;
  const total = Object.values(subs).reduce((s, n) => s + n, 0);
  const healthy = subs.active + subs.trialing;
  const healthScore = total > 0 ? Math.round((healthy / total) * 100) : 100;
  const healthEmoji = healthScore >= 90 ? "💚" : healthScore >= 70 ? "💛" : "🔴";

  const lines: string[] = [];
  lines.push("📡 Creem Store Agent — Status");
  lines.push("─".repeat(30));
  lines.push(`${healthEmoji} Health Score: ${healthScore}%`);
  lines.push(`MRR: ${fmtMoney(state.mrrCents)}`);
  lines.push(`Customers: ${state.customerCount}`);
  lines.push("");

  lines.push("Subscriptions:");
  const statuses = ["active", "trialing", "past_due", "paused", "canceled", "expired", "scheduled_cancel"] as const;
  for (const s of statuses) {
    const count = subs[s];
    if (count > 0) {
      lines.push(`  ${statusEmoji(s)} ${s}: ${count}`);
    }
  }

  if (subs.past_due > 0) {
    lines.push("");
    lines.push(`⚠️ ${subs.past_due} past due — revenue at risk`);
  }

  lines.push("");
  lines.push(`Last updated: ${state.lastUpdated ?? "never"}`);

  return lines.join("\n");
}

/**
 * /creem-report — Revenue report with MRR trends and AI insights
 */
export function formatRevenueReport(state: StoreState): string {
  const yesterday = getYesterdaySnapshot(state);
  const mrrDelta = yesterday ? state.mrrCents - yesterday.mrrCents : 0;
  const mrrArrow = mrrDelta > 0 ? "↑" : mrrDelta < 0 ? "↓" : "→";

  const lines: string[] = [];
  lines.push("📊 Creem Daily Report");
  lines.push("─".repeat(30));

  // MRR section
  lines.push(`MRR: ${fmtMoney(state.mrrCents)} ${mrrArrow} ${fmtMoney(Math.abs(mrrDelta))}`);

  // Today's revenue
  lines.push(`Today: ${fmtMoney(state.todayRevenueCents)} (${state.todayTransactionCount} transactions)`);

  // Subscription breakdown
  lines.push("");
  lines.push("Subscriptions:");
  const subs = state.subscriptions;
  const statuses = ["active", "trialing", "past_due", "paused", "canceled", "expired"] as const;
  for (const s of statuses) {
    const count = subs[s];
    const prev = yesterday?.subscriptions[s] ?? 0;
    const delta = count - prev;
    const deltaStr = delta > 0 ? ` (+${delta})` : delta < 0 ? ` (${delta})` : "";
    if (count > 0 || delta !== 0) {
      lines.push(`  ${statusEmoji(s)} ${s}: ${count}${deltaStr}`);
    }
  }

  // Churn risk
  const churnRisk = subs.past_due + subs.scheduled_cancel;
  if (churnRisk > 0) {
    lines.push("");
    lines.push(`📉 Churn risk: ${churnRisk} subscription${churnRisk > 1 ? "s" : ""} at risk`);
    if (subs.past_due > 0) {
      lines.push(`   ${subs.past_due} past due (payment failed)`);
    }
    if (subs.scheduled_cancel > 0) {
      lines.push(`   ${subs.scheduled_cancel} scheduled to cancel`);
    }
  }

  // Week trend (if snapshots available)
  const weekSnapshots = state.dailySnapshots.slice(-7);
  if (weekSnapshots.length >= 2) {
    const weekRevenue = weekSnapshots.reduce((s, d) => s + d.revenueCents, 0);
    const firstMrr = weekSnapshots[0].mrrCents;
    const lastMrr = weekSnapshots[weekSnapshots.length - 1].mrrCents;
    const weekMrrChange = lastMrr - firstMrr;
    const weekArrow = weekMrrChange > 0 ? "↑" : weekMrrChange < 0 ? "↓" : "→";

    lines.push("");
    lines.push(`📅 7-day trend:`);
    lines.push(`   Revenue: ${fmtMoney(weekRevenue)}`);
    lines.push(`   MRR: ${weekArrow} ${fmtMoney(Math.abs(weekMrrChange))}`);
  }

  return lines.join("\n");
}

/**
 * Daily digest — scheduled morning message
 */
export function formatDailyDigest(state: StoreState): string {
  const yesterday = getYesterdaySnapshot(state);
  const mrrDelta = yesterday ? state.mrrCents - yesterday.mrrCents : 0;
  const mrrArrow = mrrDelta > 0 ? "↑" : mrrDelta < 0 ? "↓" : "→";
  const today = new Date().toISOString().slice(0, 10);

  const lines: string[] = [];
  lines.push(`☀️ Good morning! Creem Digest — ${today}`);
  lines.push("─".repeat(30));

  // MRR
  lines.push(`MRR: ${fmtMoney(state.mrrCents)} ${mrrArrow} ${fmtMoney(Math.abs(mrrDelta))}`);

  // Yesterday's revenue
  if (yesterday) {
    lines.push(`Yesterday: ${fmtMoney(yesterday.revenueCents)} (${yesterday.transactionCount} tx)`);
  }

  // Sub health
  const subs = state.subscriptions;
  const total = Object.values(subs).reduce((s, n) => s + n, 0);
  const healthy = subs.active + subs.trialing;
  const healthPct = total > 0 ? Math.round((healthy / total) * 100) : 100;

  lines.push("");
  lines.push(`Subscription health: ${healthPct}% (${healthy}/${total})`);

  const statuses = ["active", "trialing", "past_due", "paused", "canceled"] as const;
  for (const s of statuses) {
    const count = subs[s];
    if (count > 0) {
      const prev = yesterday?.subscriptions[s] ?? count;
      const delta = count - prev;
      const deltaStr = delta !== 0 ? ` (${delta > 0 ? "+" : ""}${delta})` : "";
      lines.push(`  ${statusEmoji(s)} ${s}: ${count}${deltaStr}`);
    }
  }

  // Alerts
  const alerts: string[] = [];
  if (subs.past_due > 0) alerts.push(`${subs.past_due} past due`);
  if (subs.scheduled_cancel > 0) alerts.push(`${subs.scheduled_cancel} pending cancellation`);
  if (mrrDelta < -1000) alerts.push(`MRR dropped ${fmtMoney(Math.abs(mrrDelta))}`);

  if (alerts.length > 0) {
    lines.push("");
    lines.push("⚠️ Needs attention:");
    for (const a of alerts) lines.push(`  • ${a}`);
  } else {
    lines.push("");
    lines.push("✅ All clear — no issues detected");
  }

  return lines.join("\n");
}
