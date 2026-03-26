# Creem Store Agent — OpenClaw Skill

[![Tests](https://img.shields.io/badge/tests-103%20passing-brightgreen)](https://github.com/malakhov-dmitrii/creem-store-agent) [![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

AI-powered monitoring for your [Creem](https://creem.io) store. Sends real-time Telegram alerts for sales, subscriptions, disputes, and refunds. Uses Claude AI to analyze churn events and autonomously recommend retention actions — create discounts or pause subscriptions with one tap.

## Architecture

```
Creem Webhook POST
    │
    ▼
┌───────────────────────────────┐
│ OpenClaw Plugin HTTP Route    │
│ /webhook/creem                │
│ (IncomingMessage/ServerResponse)│
├───────────────────────────────┤
│ webhook-handler.ts            │
│ • HMAC-SHA256 verify          │
│ • Event deduplication         │
│ • JSON parse                  │
└───────────┬───────────────────┘
            │
            ▼
┌───────────────────────────────┐
│ event-processor.ts            │
│ • Classify event type         │
│ • Route: simple → rule-engine │
│ •        churn  → llm-analyzer│
└───────┬───────────┬───────────┘
        │           │
        ▼           ▼
┌──────────────┐ ┌──────────────────────┐
│ rule-engine  │ │ llm-analyzer.ts      │
│ • Format     │ │ • Fetch Creem context│
│   alert msg  │ │ • Claude Haiku call  │
└──────┬───────┘ │ • Parse JSON resp    │
       │         │ • Fallback to rules  │
       │         └──────────┬───────────┘
       │                    │
       ▼                    ▼
┌──────────────────────────────────────┐
│ telegram.ts                          │
│ • Send formatted alerts              │
│ • Inline buttons (Apply/Pause/Skip)  │
│ • /report, /status commands          │
└──────────────────┬───────────────────┘
                   │ user clicks button
                   ▼
┌──────────────────────────────────────┐
│ action-executor.ts                   │
│ • creem.discounts.create()           │
│ • creem.subscriptions.pause()        │
│ • Format result message              │
└──────────────────────────────────────┘
```

## Features

### Real-time Event Alerts

Handles all 13 Creem webhook events with formatted Telegram notifications:

| Event | Emoji | Urgency |
|-------|-------|---------|
| `checkout.completed` | 💰 | Low |
| `subscription.active` | 🎉 | Low |
| `subscription.paid` | 🔄 | Low |
| `subscription.canceled` | ❌ | **Churn** |
| `subscription.scheduled_cancel` | ⏰ | **Churn** |
| `subscription.unpaid` | 🚫 | Low |
| `subscription.past_due` | ⚠️ | **High** |
| `subscription.paused` | ⏸️ | Low |
| `subscription.expired` | 💀 | Medium |
| `subscription.trialing` | 🆓 | Low |
| `subscription.update` | 📝 | Low |
| `refund.created` | 💸 | Medium |
| `dispute.created` | 🚨 | **High** |

### AI Churn Analysis

When a cancellation event arrives, Claude Haiku analyzes the customer:

- **Customer tenure** and total revenue
- **Cancel reason** from webhook payload
- **Recommended action**: Create discount, pause subscription, or let go
- **Confidence score** (0-1) for autonomous execution

### Autonomous Actions

- **Auto-execute** when AI confidence ≥ 80%
- **Manual approval** via Telegram inline buttons when confidence is lower
- Actions: Apply retention discount, pause subscription, or skip

### Telegram Commands

- `/creem-status` — Check agent health and webhook status
- `/creem-report` — Revenue summary

## Demo

> Video demo coming soon — run `npm run demo:server` + `npm run demo` locally to see the full flow.

## Setup

### Prerequisites

- Node.js 20+
- [OpenClaw](https://openclaw.dev) installed and running
- Telegram bot (create via [@BotFather](https://t.me/BotFather))
- [Creem](https://creem.io) account with API key
- [Anthropic](https://console.anthropic.com) API key

### Installation

```bash
clawhub install creem-store-agent
```

Or manually:

```bash
git clone https://github.com/malakhov-dmitrii/creem-store-agent
cd creem-store-agent
npm install
npm run build
```

### Environment Variables

Create a `.env` file (see `.env.example`):

| Variable | Description |
|----------|-------------|
| `CREEM_API_KEY` | Creem API key (test: `creem_test_xxx`) |
| `CREEM_WEBHOOK_SECRET` | Webhook signing secret from Creem dashboard |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Telegram chat ID for notifications |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude Haiku |

### Webhook Setup

1. Start OpenClaw with the skill enabled
2. Expose your local server: `ngrok http 3000`
3. Register the webhook URL in your [Creem dashboard](https://creem.io/dashboard):
   ```
   https://your-ngrok-url.ngrok.io/webhook/creem
   ```
4. Select all events you want to monitor

### Test with Demo Script

```bash
npm run demo
```

This sends 5 sample webhook events (sale, subscription, cancellation, payment failure, dispute) to test the full flow.

## How It Works

1. **Creem sends a webhook** to `/webhook/creem`
2. **Signature verification** — HMAC-SHA256 with timing-safe comparison
3. **Deduplication** — event IDs tracked in memory to prevent duplicate processing
4. **Classification** — cancellations go through AI analysis; everything else gets a formatted alert
5. **AI Analysis** — Claude Haiku evaluates customer value, tenure, and cancel reason
6. **Action** — high-confidence decisions auto-execute; others await Telegram approval
7. **Execution** — creates retention discounts or pauses subscriptions via Creem SDK

### LLM Decision Logic

| Signal | Recommendation |
|--------|---------------|
| High tenure (>6 months) or high revenue (>$500) | CREATE_DISCOUNT (20-40%) |
| Medium tenure, medium value | SUGGEST_PAUSE |
| Low tenure (<2 months) or low value | NO_ACTION |

Fallback: If Claude API fails or returns unparseable response, rule-based logic takes over with confidence 0.5.

## Testing

```bash
npm test                # Run all 103 tests
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
npm run typecheck       # TypeScript type checking
```

103 tests across 7 test files covering all modules.

## Tech Stack

- **Runtime**: Node.js 20+ / OpenClaw
- **Language**: TypeScript 5.7
- **AI**: Claude Haiku 4.5 via `@anthropic-ai/sdk`
- **Payments**: Creem SDK (`creem` npm package)
- **Notifications**: Telegram Bot API (`node-telegram-bot-api`)
- **Testing**: Vitest 3.x with V8 coverage
- **Webhook Security**: HMAC-SHA256 with `timingSafeEqual`

## Project Structure

```
src/
├── types.ts           # TypeScript interfaces
├── webhook-handler.ts # HMAC verification, dedup, body parsing
├── event-processor.ts # Event classification (simple vs churn)
├── rule-engine.ts     # Emoji, urgency, alert formatting
├── llm-analyzer.ts    # Claude Haiku churn analysis
├── action-executor.ts # Creem SDK actions (discount, pause)
├── telegram.ts        # Bot wrapper, alert formatting, keyboards
├── index-helpers.ts   # Pure functions extracted from index
└── index.ts           # Plugin entry point, wiring
tests/                 # Mirror of src/ with .test.ts files
demo/
└── demo-script.ts     # Sends sample webhooks for video recording
```

## License

MIT
