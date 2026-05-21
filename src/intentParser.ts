import { GoogleGenAI, Type } from "@google/genai";
import { TransactionIntent } from "./types";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("Missing GEMINI_API_KEY environment variable.");
}

const ai = new GoogleGenAI({ apiKey });

const INTENT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    action: {
      type: Type.STRING,
      enum: ["TRANSFER", "BALANCE_CHECK", "CONVERSION", "UNKNOWN"],
      description: "The structural financial action type identified from the raw string.",
    },
    amount: {
      type: Type.NUMBER,
      description: "The numeric value of the transaction. Set to null if unspecified.",
      nullable: true,
    },
    currency: {
      type: Type.STRING,
      description: "The currency code, e.g., USD, EUR, GBP. Set to null if unspecified.",
      nullable: true,
    },
    recipient: {
      type: Type.STRING,
      description: "The target counterparty name, account address, or identifier. Set to null if unspecified.",
      nullable: true,
    },
    reference: {
      type: Type.STRING,
      description: "Payment details, notes, memo context, or reference tag. Set to null if unspecified.",
      nullable: true,
    },
    raw_input: {
      type: Type.STRING,
      description: "The verbatim original text string sent by the user.",
    },
  },
  required: ["action", "raw_input"],
};

export async function parseIntent(rawText: string): Promise<TransactionIntent> {
  if (!rawText.trim()) {
    throw new Error("Empty input text provided.");
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: rawText,
    config: {
      temperature: 0.1,
      systemInstruction: "You are a deterministic financial intent parser. Extract structured payment parameters from raw user inputs.\n" +
        "The user input can be in English, Nigerian Pidgin, or Yoruba.\n\n" +
        "Guidelines:\n" +
        "1. Action type must be one of:\n" +
        "   - 'TRANSFER': For transfers, payments, sending money (e.g., 'send', 'transfer', 'pay', 'fi ... ranṣẹ', 'bami fi', 'give').\n" +
        "   - 'BALANCE_CHECK': For checking balance (e.g., 'check balance', 'wo balance mi', 'how much I get', 'what is my balance').\n" +
        "   - 'UNKNOWN': If not recognizable.\n" +
        "2. Amount: Extract the numeric value. Convert written number words to numbers (e.g., 'five thousand' -> 5000, '500' -> 500).\n" +
        "3. Currency: Extract the currency. Standardize to codes:\n" +
        "   - 'naira', '₦', 'NGN' -> 'NGN'\n" +
        "   - 'STT', 'somnia' -> 'STT'\n" +
        "   - 'USD', 'dollars', '$' -> 'USD'\n" +
        "   - Default to 'STT' if not mentioned.\n" +
        "4. Recipient: Extract the name (e.g. 'Chidi', 'Tunde', 'Alice') or hex EVM address (e.g. '0x...').\n" +
        "5. Reference: Extract the payment reason, note or memo context (e.g. 'generator fuel', 'ewa', 'food', 'rent'). Keep local terms like 'ewa' as is.\n\n" +
        "Examples:\n" +
        "- Input: 'Send five thousand naira to Chidi for the generator fuel'\n" +
        "  Output: { \"action\": \"TRANSFER\", \"amount\": 5000, \"currency\": \"NGN\", \"recipient\": \"Chidi\", \"reference\": \"generator fuel\" }\n" +
        "- Input: 'fi 500 naira ranṣẹ si Tunde fun ewa'\n" +
        "  Output: { \"action\": \"TRANSFER\", \"amount\": 500, \"currency\": \"NGN\", \"recipient\": \"Tunde\", \"reference\": \"ewa\" }",
      responseMimeType: "application/json",
      responseSchema: INTENT_SCHEMA,
    },
  });

  const textOutput = response.text;
  if (!textOutput) {
    throw new Error("Received empty response from the AI model.");
  }

  const parsed = JSON.parse(textOutput);

  // Normalize structure to align strictly with the TransactionIntent contract
  return {
    action: (parsed.action || "UNKNOWN") as TransactionIntent["action"],
    amount: typeof parsed.amount === "number" ? parsed.amount : null,
    currency: typeof parsed.currency === "string" ? parsed.currency : null,
    recipient: typeof parsed.recipient === "string" ? parsed.recipient : null,
    reference: typeof parsed.reference === "string" ? parsed.reference : null,
    raw_input: parsed.raw_input || rawText,
  };
}
