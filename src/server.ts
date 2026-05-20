import dotenv from "dotenv";
dotenv.config();

import { Bot, InlineKeyboard } from "grammy";
import * as session from "./session";
import { parseIntent } from "./intentParser";
import { transcribeVoice } from "./transcribe";
import { settle } from "./settler";
import { TransactionIntent } from "./types";

// Startup validation
const token = process.env.TELEGRAM_BOT_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY;

if (!token || token === "YOUR_TELEGRAM_BOT_TOKEN" || !geminiKey || geminiKey === "YOUR_GEMINI_API_KEY") {
  console.error("Critical configuration failure: TELEGRAM_BOT_TOKEN or GEMINI_API_KEY is not configured.");
  process.exit(1);
}

if (!process.env.OPENAI_API_KEY && !process.env.MOCK_TRANSCRIPTION_TEXT) {
  console.warn("Configuration warning: Neither OPENAI_API_KEY nor MOCK_TRANSCRIPTION_TEXT is set. Voice transcription fallback may fail.");
}

// Bot initialization
const bot = new Bot(token);

// Helper to build the Markdown transaction preview without any unicode emojis
function buildPreview(intent: TransactionIntent): string {
  let text = "Transaction Preview\n";
  text += "===\n";
  text += `Action: ${intent.action}\n`;
  if (intent.amount !== null) {
    text += `Amount: ${intent.amount} ${intent.currency || "USD"}\n`;
  }
  if (intent.recipient !== null) {
    text += `Recipient: ${intent.recipient}\n`;
  }
  if (intent.reference !== null) {
    text += `Memo: ${intent.reference}\n`;
  }
  text += `Raw Input: ${intent.raw_input}\n\n`;
  text += "Confirm this transaction?";
  return text;
}

// Core pipeline executor
async function runPipeline(ctx: any, rawText: string) {
  const userId = ctx.from?.id;
  if (!userId) {
    throw new Error("Could not identify sender user ID.");
  }

  const intent = await parseIntent(rawText);

  if (intent.action === "UNKNOWN") {
    await ctx.reply(
      "Unable to determine transaction intent. Please specify action (e.g., Transfer, Balance Check) along with amount and recipient."
    );
    return;
  }

  session.set(userId, intent);

  const previewText = buildPreview(intent);
  const keyboard = new InlineKeyboard()
    .text("Confirm", "confirm_payment")
    .text("Cancel", "cancel_payment");

  await ctx.reply(previewText, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
}

// Command Handlers
bot.command("start", async (ctx) => {
  await ctx.reply(
    "Welcome to VeloRail, an intent-driven financial gateway.\n\n" +
    "Send a command like:\n" +
    "- Transfer 100 USD to Bob\n" +
    "- Check balance\n" +
    "- Convert 500 EUR to GBP\n\n" +
    "You can also send a short voice message containing your request."
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "VeloRail Help:\n" +
    "- /start: Welcome message\n" +
    "- /help: Show help info\n" +
    "- /cancel: Clear any active transaction in progress\n" +
    "- /status: Show system status\n\n" +
    "Supported Transaction Actions: TRANSFER, BALANCE_CHECK, CONVERSION\n" +
    "Voice note constraints: Maximum 30 seconds, maximum 50KB file size."
  );
});

bot.command("cancel", async (ctx) => {
  const userId = ctx.from?.id;
  if (userId) {
    session.clear(userId);
  }
  await ctx.reply("Transaction state cleared.");
});

bot.command("status", async (ctx) => {
  const activeCount = session.activeCount();
  const uptime = Math.floor(process.uptime());
  await ctx.reply(
    `System Status:\n` +
    `- Active cached sessions: ${activeCount}\n` +
    `- Uptime: ${uptime} seconds`
  );
});

// Message Listeners
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) {
    return;
  }

  try {
    await ctx.replyWithChatAction("typing");
    await runPipeline(ctx, text);
  } catch (error: any) {
    console.error(error);
    await ctx.reply(`Error parsing intent: ${error.message || "An unknown error occurred."}`);
  }
});

bot.on("message:voice", async (ctx) => {
  try {
    await ctx.replyWithChatAction("typing");
    const statusMsg = await ctx.reply("Transcribing...");

    const voice = ctx.message.voice;
    const transcript = await transcribeVoice(voice.file_id, voice.duration, bot);

    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      `Heard: "${transcript}"`
    );

    await runPipeline(ctx, transcript);
  } catch (error: any) {
    console.error(error);
    await ctx.reply(`Error processing voice: ${error.message || "Transcription failed."}`);
  }
});

// Interactive Inline Callbacks
bot.callbackQuery("confirm_payment", async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const userId = ctx.from?.id;
    if (!userId) {
      throw new Error("User ID not found.");
    }

    const intent = session.get(userId);
    if (!intent) {
      await ctx.editMessageText("Session expired or transaction not found.");
      return;
    }

    // Atomic session clearance prior to settlement
    session.clear(userId);

    await ctx.editMessageText("Processing...");

    const settlementResult = await settle(intent);

    await ctx.editMessageText(settlementResult.receipt, {
      parse_mode: "Markdown",
    });
  } catch (error: any) {
    console.error(error);
    await ctx.editMessageText(`Error processing settlement: ${error.message || "Execution failed."}`);
  }
});

bot.callbackQuery("cancel_payment", async (ctx) => {
  try {
    const userId = ctx.from?.id;
    if (userId) {
      session.clear(userId);
    }
    await ctx.answerCallbackQuery("Cancelled.");
    await ctx.editMessageText("Transaction cancelled. No funds were moved.");
  } catch (error: any) {
    console.error(error);
  }
});

// Global Error Handler
bot.catch((err) => {
  console.error(`Error in update ${err.ctx.update.update_id}:`, err.error);
});

// Bot Launch
bot.start({
  onStart: (info) => {
    console.log("@" + info.username);
  },
});
