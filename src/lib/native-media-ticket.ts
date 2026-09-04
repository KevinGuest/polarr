import { randomBytes } from "node:crypto";
import { getUserByToken } from "@/lib/db";

const TICKET_TTL_MS = 12 * 60 * 60 * 1000;
const tickets = new Map<string, { credential: string; expiresAt: number }>();

export function issueNativeMediaTicket(credential: string) {
  const now = Date.now();
  for (const [ticket, entry] of tickets) {
    if (entry.expiresAt <= now) tickets.delete(ticket);
  }
  const ticket = randomBytes(24).toString("base64url");
  const expiresAt = now + TICKET_TTL_MS;
  tickets.set(ticket, { credential, expiresAt });
  return { ticket, expiresAt };
}

export function getUserByNativeMediaTicket(ticket: string | null) {
  if (!ticket) return null;
  const entry = tickets.get(ticket);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    tickets.delete(ticket);
    return null;
  }
  return getUserByToken(entry.credential);
}

