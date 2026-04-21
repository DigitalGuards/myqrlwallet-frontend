/**
 * Session store — localStorage persistence for dApp sessions (v2).
 *
 * v2 stores an AES-256 session key (derived via ML-KEM-768 + HKDF-SHA-256)
 * rather than an ECIES private key. Records without `version: 2` are
 * dropped on load — v1 sessions cannot be migrated and users re-pair.
 */

import type { DAppSession } from './types';
import { SessionStatus } from './types';

const STORAGE_KEY = 'qrlconnect:sessions';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class SessionStore {
  static save(session: DAppSession): void {
    const sessions = SessionStore.getAll();
    const index = sessions.findIndex((s) => s.id === session.id);
    if (index >= 0) {
      sessions[index] = session;
    } else {
      sessions.push(session);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }

  static getAll(): DAppSession[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Partial<DAppSession>[];
      const now = Date.now();
      const valid: DAppSession[] = [];
      let dropped = 0;
      for (const s of parsed) {
        if (s.version !== 2) {
          dropped++;
          continue;
        }
        if (!s.createdAt || now - s.createdAt >= SESSION_TTL_MS) {
          dropped++;
          continue;
        }
        valid.push(s as DAppSession);
      }
      if (dropped > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
      }
      return valid;
    } catch {
      return [];
    }
  }

  static get(channelId: string): DAppSession | null {
    return SessionStore.getAll().find((s) => s.id === channelId) || null;
  }

  static remove(channelId: string): void {
    const sessions = SessionStore.getAll().filter((s) => s.id !== channelId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }

  static updateStatus(channelId: string, status: SessionStatus): void {
    const session = SessionStore.get(channelId);
    if (session) {
      session.status = status;
      session.lastActivity = Date.now();
      SessionStore.save(session);
    }
  }

  static clearAll(): void {
    localStorage.removeItem(STORAGE_KEY);
  }
}
