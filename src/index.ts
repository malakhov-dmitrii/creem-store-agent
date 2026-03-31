import type { SkillContext, CreemWebhookPayload, LLMDecision, ChurnContext } from "./types.js";
import { createWebhookHandler } from "./webhook-handler.js";
import { classifyEvent } from "./event-processor.js";
import { formatEventAlert } from "./rule-engine.js";
import { analyzeChurn } from "./llm-analyzer.js";
import { executeAction, formatActionResult } from "./action-executor.js";
import { createTelegramBot, formatChurnAlert, buildInlineKeyboard } from "./telegram.js";
import { extractChurnContext, shouldAutoExecute } from "./index-helpers.js";
import { loadState, saveState, takeDailySnapshot, addSnapshot, todayStr } from "./store-state.js";
import type { StoreState } from "./store-state.js";
import { updateStateFromEvent } from "./store-metrics.js";
import { formatStatusReport, formatRevenueReport, formatDailyDigest } from "./commands.js";

const pendingDecisions = new Map<string, { decision: LLMDecision; context: ChurnContext }>();

const AUTO_EXECUTE_THRESHOLD = 0.8;
const DIGEST_HOUR = 9; // Send daily digest at 9 AM
const DIGEST_CHECK_INTERVAL = 60 * 60 * 1000; // Check every hour

export async function onStartup(ctx: SkillContext): Promise<void> {
  const {
    CREEM_API_KEY,
    CREEM_WEBHOOK_SECRET,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    ANTHROPIC_API_KEY,
  } = ctx.config;

  // --- Initialize SDKs (dynamic imports to avoid bundling issues) ---
  const { Creem } = await import("creem");
  const creem = new Creem({ apiKey: CREEM_API_KEY, serverIdx: 1 });

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const TelegramBotLib = (await import("node-telegram-bot-api")).default;
  const rawBot = new TelegramBotLib(TELEGRAM_BOT_TOKEN, { polling: true });
  const bot = createTelegramBot(rawBot, TELEGRAM_CHAT_ID);

  // --- Load persisted state ---
  const statePath = ctx.config.STATE_PATH ?? "data/store-state.json";
  let state: StoreState = loadState(statePath);

  function persistState(): void {
    saveState(statePath, state);
  }

  // --- Event Handler ---
  async function handleEvent(payload: CreemWebhookPayload): Promise<void> {
    // Update store metrics from every event
    state = updateStateFromEvent(state, payload);
    persistState();

    const classified = classifyEvent(payload);

    if (classified.category === "simple") {
      const alert = formatEventAlert(payload);
      await bot.sendMessage(alert);
      return;
    }

    // Churn event — run LLM analysis
    const churnCtx = await extractChurnContext(payload, creem as any);

    ctx.log.info(`Analyzing churn for ${churnCtx.customerEmail} (${churnCtx.productName})`);

    const decision = await analyzeChurn(churnCtx, anthropic as any);

    const alertMsg = formatChurnAlert(churnCtx, decision);
    const keyboard = buildInlineKeyboard(churnCtx.subscriptionId, decision.action);

    await bot.sendMessage(alertMsg, {
      parse_mode: "HTML",
      ...(keyboard.length > 0 ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });

    if (shouldAutoExecute(decision, AUTO_EXECUTE_THRESHOLD)) {
      const result = await executeAction(decision, churnCtx, creem as any);
      const resultMsg = formatActionResult(result, churnCtx);
      await bot.sendMessage(`🤖 Auto-executed (confidence ${Math.round(decision.confidence * 100)}%):\n${resultMsg}`);
    } else {
      pendingDecisions.set(churnCtx.subscriptionId, { decision, context: churnCtx });
    }
  }

  // --- Telegram callback handler ---
  async function handleTelegramAction(data: string): Promise<void> {
    const [action, subscriptionId] = data.split(":");
    if (!action || !subscriptionId) return;

    if (action === "skip") {
      pendingDecisions.delete(subscriptionId);
      await bot.sendMessage(`⏭️ Skipped action for ${subscriptionId}`);
      return;
    }

    if (action === "apply" || action === "pause") {
      const entry = pendingDecisions.get(subscriptionId);
      if (!entry) {
        await bot.sendMessage(`❌ No pending decision for ${subscriptionId}`);
        return;
      }
      const overrideDecision = action === "apply"
        ? entry.decision
        : { ...entry.decision, action: "SUGGEST_PAUSE" as const };
      const result = await executeAction(overrideDecision, entry.context, creem as any);
      const resultMsg = formatActionResult(result, entry.context);
      await bot.sendMessage(resultMsg);
      pendingDecisions.delete(subscriptionId);
      return;
    }
  }

  bot.onCallbackQuery((query) => {
    if (query.data) {
      handleTelegramAction(query.data).catch((err) =>
        ctx.log.error(`Callback handler error: ${err}`)
      );
    }
  });

  // --- Telegram commands (real data, not stubs) ---
  bot.onText(/\/creem-report/, async () => {
    await bot.sendMessage(formatRevenueReport(state));
  });

  bot.onText(/\/creem-status/, async () => {
    await bot.sendMessage(formatStatusReport(state));
  });

  // --- Daily digest scheduler ---
  let lastDigestDate = "";

  const digestInterval = setInterval(() => {
    const now = new Date();
    const today = todayStr();

    if (now.getHours() === DIGEST_HOUR && lastDigestDate !== today) {
      lastDigestDate = today;

      // Take snapshot before sending digest
      const snapshot = takeDailySnapshot(state);
      state = addSnapshot(state, snapshot);
      persistState();

      bot.sendMessage(formatDailyDigest(state)).catch((err) =>
        ctx.log.error(`Daily digest error: ${err}`)
      );

      // Reset daily counters
      state = { ...state, todayRevenueCents: 0, todayTransactionCount: 0 };
      persistState();

      ctx.log.info(`Daily digest sent for ${today}`);
    }
  }, DIGEST_CHECK_INTERVAL);

  // --- Register webhook route ---
  const webhookHandler = createWebhookHandler({
    secret: CREEM_WEBHOOK_SECRET,
    onEvent: handleEvent,
  });

  ctx.api.registerHttpRoute({
    path: "/webhook/creem",
    auth: "plugin",
    handler: webhookHandler,
  });

  // Store interval ref for cleanup
  (ctx as any).__digestInterval = digestInterval;

  ctx.log.info("Creem Store Agent started — webhook registered at /webhook/creem");
}

export async function onShutdown(ctx: SkillContext): Promise<void> {
  ctx.log.info("Creem Store Agent shutting down");
  const interval = (ctx as any).__digestInterval;
  if (interval) clearInterval(interval);
  pendingDecisions.clear();
}
