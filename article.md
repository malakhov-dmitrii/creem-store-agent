---
title: "Building an AI Agent That Saves Your SaaS Revenue"
published: false
description: "How I built an OpenClaw skill that monitors Creem webhooks and uses Claude AI to prevent churn automatically"
tags: ai, saas, typescript, opensource
cover_image:
---

What if your payment system could detect a churning customer, figure out their lifetime value, and auto-apply a retention discount — all before you finish your morning coffee?

That's what I built. An OpenClaw skill that plugs into [Creem](https://creem.io) (a Merchant of Record for SaaS) and turns webhook events into intelligent, autonomous actions. Here's how it works and why it matters.

{% embed https://youtu.be/LkCxjkBaDqQ %}

## The Problem: You Find Out Too Late

Most SaaS founders discover churn in their monthly metrics. By then the customer is gone, the feedback window closed, and the revenue lost.

Creem already sends webhook events for every subscription change — cancellations, payment failures, disputes. But those events just sit in a log unless you build something to act on them.

I wanted something that:
- Alerts me instantly when money is at risk
- Analyzes *why* the customer is leaving
- Takes action autonomously when it's confident enough
- Asks me for approval when it's not

## The Solution: Creem Store Agent

An [OpenClaw](https://openclaw.dev) skill that receives Creem webhooks and runs them through a decision pipeline:

```
Creem Webhook
    |
    v
HMAC-SHA256 Verify -> Dedup -> Classify
    |                              |
    v                              v
Simple events              Churn events
(format + alert)     (fetch context + AI analysis)
    |                              |
    v                              v
Telegram alert         Claude Haiku decides:
                       - CREATE_DISCOUNT (20-40%)
                       - SUGGEST_PAUSE
                       - NO_ACTION
                            |
                    confidence >= 80%?
                     /              \
                   yes               no
                    |                 |
              auto-execute    Telegram buttons
                             [Apply] [Pause] [Skip]
```

It handles all 13 Creem webhook events — from `checkout.completed` to `dispute.created` — and routes cancellations through AI analysis while sending simple formatted alerts for everything else.

## The Interesting Parts

### Webhook Security

Creem signs every webhook with HMAC-SHA256. The handler verifies signatures with timing-safe comparison to prevent timing attacks, then deduplicates events by ID (Creem retries failed deliveries):

```typescript
export function verifySignature(
  body: string, signature: string, secret: string
): boolean {
  const expected = createHmac("sha256", secret)
    .update(body).digest("hex");
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(
    Buffer.from(expected), Buffer.from(signature)
  );
}
```

Nothing fancy here, but I've seen too many webhook handlers skip `timingSafeEqual`. Don't be that person.

### The LLM Prompt

When a cancellation event arrives, the agent fetches context from Creem (subscription history, customer tenure, total revenue) and builds a prompt:

```typescript
export function buildChurnPrompt(ctx: ChurnContext): string {
  return `You are a SaaS retention analyst.
A customer is about to churn. Analyze and recommend ONE action.

Customer: ${ctx.customerEmail}
Plan: ${ctx.productName} ($${ctx.price}/mo)
Tenure: ${ctx.tenureMonths} months
Total Revenue: $${ctx.totalRevenue}
Cancel Reason: ${ctx.cancelReason || "not provided"}

Available actions:
- CREATE_DISCOUNT: Retention discount. Params: { percentage, durationMonths }
- SUGGEST_PAUSE: Pause instead of cancel. Params: {}
- NO_ACTION: Let them go. Params: {}

Rules:
- High-value (>$500 total or >6 months): prefer CREATE_DISCOUNT 20-40%
- Low-tenure (<2 months) or low-value: prefer NO_ACTION
- Medium cases: consider SUGGEST_PAUSE

Respond in JSON only:
{"action": "...", "reason": "...", "confidence": 0.0-1.0, "params": {...}}`;
}
```

Claude Haiku responds in ~200ms with a structured decision. The parser handles code blocks, validates the response shape, and clamps confidence to 0-1. If anything goes wrong — API timeout, unparseable response — a rule-based fallback takes over with confidence 0.5 (never auto-executes).

### Autonomous Actions with a Safety Net

The confidence threshold is the key design decision. At 80%+, the agent auto-executes: creates a retention discount or pauses the subscription through the Creem SDK. Below 80%, it sends a Telegram message with inline buttons:

```
[Apply Discount] [Pause Instead] [Skip]
```

This means high-confidence, high-value saves happen instantly (before the customer moves on), while borderline cases get human judgment. The inline keyboard in Telegram makes approval a single tap.

The actual execution is clean — `creem.discounts.create()` for retention discounts, `creem.subscriptions.pause()` for pauses:

```typescript
case "CREATE_DISCOUNT": {
  const discount = await creem.discounts.create({
    name: `Retention ${percentage}% off`,
    type: "percentage",
    percentage,
    duration: "repeating",
    durationInMonths: months,
    appliesToProducts: [ctx.productId],
  });
  return {
    success: true,
    action: "CREATE_DISCOUNT",
    details: `Created ${percentage}% discount for ${months} months (code: ${discount.code})`,
  };
}
```

## Running the Demo

The repo includes a standalone server and demo script that simulates 5 Creem webhook events — a new sale, subscription activation, cancellation (triggers AI), payment failure, and a dispute:

```bash
git clone https://github.com/malakhov-dmitrii/creem-store-agent
cd creem-store-agent
npm install

# Terminal 1: Start the server
CREEM_WEBHOOK_SECRET=whsec_demo_secret npm run demo:server

# Terminal 2: Fire events
CREEM_WEBHOOK_SECRET=whsec_demo_secret npm run demo
```

You'll see each event processed, classified, and — for the cancellation — analyzed with either Claude (if you set `ANTHROPIC_API_KEY`) or the rule-based fallback.

Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to get real Telegram alerts with inline action buttons.

## v1.1: MRR Tracking, Daily Digest, Slash Commands

After the initial release, I shipped a major update that turns the agent from a reactive alert system into a full store operations dashboard.

### Webhook-Driven MRR Tracking

Every subscription event updates MRR in real time. No polling, no scheduled jobs — just webhooks:

- `subscription.active` → adds plan price to MRR
- `subscription.canceled` → subtracts it
- `subscription.upgraded` → calculates the delta
- `subscription.past_due` → flags as at-risk revenue

The agent tracks MRR, active subscriptions, churn count, and new revenue as running totals persisted across restarts.

### Daily Digest

Every morning, the agent sends a Telegram summary:

```
📊 Daily Digest — April 1, 2026

MRR: $4,270 (+$120 vs yesterday)
Active Subs: 47 (+2)
New Revenue: $340
Churn Risk: 3 subscriptions past due

⚠️ Past-due: customer_abc ($29/mo, 3 days overdue)
```

No dashboard to open. No CSV to export. It comes to you.

### Slash Commands

Two Telegram commands for on-demand insights:

**`/creem-status`** — health score (percentage), subscription breakdown by status, past-due warnings. Think of it as `kubectl get pods` for your revenue.

**`/creem-report`** — MRR trends with yesterday comparison, 7-day analytics, churn risk assessment with specific customer flags.

### State Persistence

JSON snapshots with 90-day retention. The agent remembers yesterday's MRR to calculate deltas, tracks which customers have been flagged before, and builds trend data over time. No database needed — just flat files that survive restarts.

## Why Code, Not Prompts

Most OpenClaw bounty submissions take a different approach: they write markdown skill files (SKILL.md, HEARTBEAT.md) that instruct the LLM what to do. The "agent intelligence" lives in natural language instructions, not in code.

This agent does it differently. The churn analysis, LTV calculation, confidence scoring, and autonomous actions are all **TypeScript code** with explicit logic, error handling, and fallbacks. Claude Haiku is called via the Anthropic SDK for one specific task — analyzing churn context and recommending an action — with structured JSON output, validation, and a rule-based fallback if the LLM fails.

Why does this matter?

- **Testability**: you can't unit test a markdown prompt. You can test TypeScript functions. This agent has 138 of them.
- **Reliability**: LLM-as-orchestrator means every action depends on the model understanding your instructions correctly. Code-as-orchestrator means actions execute deterministically, with LLM used where it adds value (nuanced churn analysis) and rules used everywhere else.
- **Debuggability**: when something goes wrong, you read a stack trace, not a conversation log.

## Testing

138 tests across 10 modules, running in ~400ms. Every component is tested in isolation — webhook handler, event processor, rule engine, LLM analyzer (with mocked Claude responses), action executor, Telegram bot, store metrics, store state, commands, and helper functions:

```bash
npm test           # 138 tests, ~400ms
npm run test:coverage  # 84% statement coverage, 91% method coverage
npm run typecheck  # TypeScript strict mode, zero any
```

The LLM analyzer tests cover edge cases: malformed JSON, missing fields, code blocks in responses, confidence clamping, and API failures falling back to rules. The store metrics tests verify MRR calculations across every subscription lifecycle event. The commands tests validate slash command output formatting.

## Why OpenClaw?

OpenClaw runs locally on your machine and connects to any messaging service. Building this as an OpenClaw skill means:

- **No server to deploy** — runs alongside your other agents
- **Messaging agnostic** — Telegram today, Slack tomorrow
- **Composable** — combine with other skills (e.g., a CRM updater or Slack notifier)
- **Privacy** — your API keys and customer data stay local

Install it: `clawhub install creem-store-agent`

## Architecture at a Glance

```
                    ┌─────────────────┐
                    │   Creem API     │
                    │  (webhooks)     │
                    └────────┬────────┘
                             │ HMAC-signed POST
                             v
                    ┌─────────────────┐
                    │ Webhook Handler │ verify → dedup → classify
                    └────────┬────────┘
                             │
                ┌────────────┼────────────┐
                v            v            v
          Simple events  Churn events  Metrics update
          (format+alert) (AI pipeline) (MRR tracking)
                |            |            |
                v            v            v
          ┌──────────┐ ┌──────────┐ ┌──────────────┐
          │ Telegram  │ │ Claude   │ │ Store State  │
          │ Alert     │ │ Haiku    │ │ (persistence)│
          └──────────┘ │ Analysis │ └──────┬───────┘
                       └────┬─────┘        │
                            v              v
                    ┌──────────────┐ ┌──────────────┐
                    │ Rule Engine  │ │ Daily Digest  │
                    │ + Confidence │ │ + /commands   │
                    └──────┬───────┘ └──────────────┘
                           │
                  ┌────────┼────────┐
                  v                 v
            ≥80% confidence    <80% confidence
            Auto-execute       Telegram buttons
            (discount/pause)   [Apply] [Pause] [Skip]
```

12 TypeScript modules, each with dedicated tests:

| Module | Purpose | Tests |
|--------|---------|-------|
| `webhook-handler` | HMAC verify, dedup, parse | 11 |
| `event-processor` | Classify, route events | 14 |
| `llm-analyzer` | Claude Haiku churn analysis | 25 |
| `rule-engine` | Fallback rules + confidence | 21 |
| `action-executor` | Creem SDK calls | 10 |
| `telegram` | Alerts, buttons, commands | 8 |
| `store-metrics` | MRR, revenue tracking | 15 |
| `store-state` | JSON persistence | 8 |
| `commands` | /creem-status, /creem-report | 12 |
| `index-helpers` | Event formatting, routing | 14 |

## What's Next

- **Slack integration** — same alerts, different channel
- **Custom retention playbooks** — define rules per product (e.g., always offer 50% to annual subscribers)
- **Multi-store** — monitor multiple Creem accounts from one agent
- **Anomaly detection** — flag unusual spikes in cancellations or payment failures

## Try It

The code is MIT licensed and on GitHub: [malakhov-dmitrii/creem-store-agent](https://github.com/malakhov-dmitrii/creem-store-agent)

Install from ClawHub:
```bash
clawhub install creem-store-agent
```

Or try the demo without any API keys:
```bash
git clone https://github.com/malakhov-dmitrii/creem-store-agent
cd creem-store-agent && npm install
CREEM_WEBHOOK_SECRET=whsec_demo npm run demo:server
# Another terminal:
CREEM_WEBHOOK_SECRET=whsec_demo npm run demo
```

If you're running a SaaS on Creem and losing sleep over churn, give it a spin. Open an issue if something breaks. Star the repo if it doesn't.

---

*Built for the [Creem Scoops](https://creem.io/scoops) bounty program with [OpenClaw](https://openclaw.dev), [Creem SDK](https://docs.creem.io), and [Claude Haiku](https://anthropic.com).*
