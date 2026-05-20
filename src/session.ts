import { TransactionIntent, PendingSession } from "./types";

const sessions = new Map<number, PendingSession>();

const TTL_MS = 300000; // 5 minutes

export function set(userId: number, intent: TransactionIntent): void {
  sessions.set(userId, {
    intent,
    expiresAt: Date.now() + TTL_MS,
  });
}

export function get(userId: number): TransactionIntent | null {
  const session = sessions.get(userId);
  if (!session) {
    return null;
  }

  if (Date.now() > session.expiresAt) {
    sessions.delete(userId);
    return null;
  }

  return session.intent;
}

export function clear(userId: number): void {
  sessions.delete(userId);
}

export function activeCount(): number {
  // Clean up any expired sessions first to ensure accurate count
  const now = Date.now();
  for (const [userId, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(userId);
    }
  }
  return sessions.size;
}
