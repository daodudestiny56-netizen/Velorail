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
      systemInstruction: "You are a deterministic financial intent parser. Extract structured payment parameters. Return null for any field you cannot confidently extract. Never hallucinate values.",
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
