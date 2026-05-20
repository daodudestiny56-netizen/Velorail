export type TransactionType = "TRANSFER" | "BALANCE_CHECK" | "CONVERSION" | "UNKNOWN";

export interface TransactionIntent {
  action: TransactionType;
  amount: number | null;
  currency: string | null;
  recipient: string | null;
  reference: string | null;
  raw_input: string;
}

export interface PendingSession {
  intent: TransactionIntent;
  expiresAt: number;
}
