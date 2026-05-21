import dotenv from "dotenv";
dotenv.config();

import { Bot, InlineKeyboard } from "grammy";
import * as session from "./session";
import { parseIntent } from "./intentParser";
import { transcribeVoice } from "./transcribe";
import { settle } from "./settler";
import { TransactionIntent } from "./types";
import { isValidAddress, getWalletBalance, getBotWalletAddress, estimateTransferGas } from "./evm";

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

// Helper to build the Markdown transaction preview matching the setup guide format
function buildPreview(intent: TransactionIntent): string {
  let text = "💸 *Transaction Preview*\n\n";
  text += `Type: ${intent.action}\n`;
  if (intent.amount !== null) {
    text += `Amount: ${intent.amount} ${intent.currency || "STT"}\n`;
  }
  if (intent.recipient !== null) {
    text += `Recipient: \`${intent.recipient}\`\n`;
  }
  if (intent.reference !== null) {
    text += `Memo: ${intent.reference}\n`;
  }
  if (intent.estimatedGas) {
    text += `Estimated Gas Fee: ${intent.estimatedGas} STT\n`;
  }
  text += `\nParsed from: "${intent.raw_input}"\n\n`;
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

  if (intent.action === "BALANCE_CHECK") {
    const target = intent.recipient && isValidAddress(intent.recipient) ? intent.recipient : undefined;
    const balance = await getWalletBalance(target);
    const addr = target || getBotWalletAddress();
    await ctx.reply(`📊 *Wallet Balance*\n\nAddress: \`${addr}\`\nBalance: *${balance} STT*`, {
      parse_mode: "Markdown"
    });
    return;
  }

  if (intent.action === "TRANSFER") {
    if (!intent.recipient) {
      throw new Error("Missing recipient address for transfer.");
    }
    if (!isValidAddress(intent.recipient)) {
      throw new Error(`Could not find a valid wallet address for '${intent.recipient}'. Please provide a full 0x address.`);
    }
    if (intent.amount === null || intent.amount <= 0) {
      throw new Error("Missing or invalid amount for transfer. Please specify a numeric amount.");
    }

    // Dry-run gas estimation to display gas fee and catch revert/insufficient fund issues upfront
    await ctx.replyWithChatAction("typing");
    const estimation = await estimateTransferGas(intent.recipient, intent.amount);
    intent.estimatedGas = estimation.totalFeeEther;
  }

  session.set(userId, intent);

  const previewText = buildPreview(intent);
  const keyboard = new InlineKeyboard()
    .text("✅ Confirm", "confirm_payment")
    .text("❌ Cancel", "cancel_payment");

  await ctx.reply(previewText, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
}

// Command Handlers
bot.command("start", async (ctx) => {
  await ctx.reply(
    "Welcome to VeloRail, an intent-driven financial gateway on Somnia Testnet.\n\n" +
    "Send a command like:\n" +
    "- Transfer 0.1 STT to 0x123...\n" +
    "- Check balance\n\n" +
    "You can also send a short voice message containing your request."
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "VeloRail Help:\n" +
    "- /start: Welcome message\n" +
    "- /help: Show help info\n" +
    "- /balance: Check native STT balance of the bot wallet\n" +
    "- /cancel: Clear any active transaction in progress\n" +
    "- /status: Show system status\n\n" +
    "Supported Transaction Actions: TRANSFER, BALANCE_CHECK\n" +
    "Voice note constraints: Maximum 30 seconds, maximum 50KB file size."
  );
});

bot.command("balance", async (ctx) => {
  try {
    await ctx.replyWithChatAction("typing");
    const balance = await getWalletBalance();
    await ctx.reply(`📊 *Wallet Balance*\n\nAddress: \`${getBotWalletAddress()}\`\nBalance: *${balance} STT*`, {
      parse_mode: "Markdown"
    });
  } catch (error: any) {
    console.error(error);
    await ctx.reply(`Error checking balance: ${error.message || "Failed to query balance."}`);
  }
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
    await ctx.editMessageText("Transaction cancelled.");
  } catch (error: any) {
    console.error(error);
  }
});

// Global Error Handler
bot.catch((err) => {
  console.error(`Error in update ${err.ctx.update.update_id}:`, err.error);
});

console.log("[VeloRail] Starting...");

// Bot Launch
bot.start({
  onStart: (info) => {
    console.log(`[VeloRail] ✅ Running as @${info.username}`);
  },
});
