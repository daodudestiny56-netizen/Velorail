export type TransactionType = "TRANSFER" | "BALANCE_CHECK" | "CONVERSION" | "UNKNOWN";

export interface TransactionIntent {
  action: TransactionType;
  amount: number | null;
  currency: string | null;
  recipient: string | null;
  reference: string | null;
  raw_input: string;
  estimatedGas?: string | null;
  originalAmount?: number | null;
  originalCurrency?: string | null;
}

export interface PendingSession {
  intent: TransactionIntent;
  expiresAt: number;
}
