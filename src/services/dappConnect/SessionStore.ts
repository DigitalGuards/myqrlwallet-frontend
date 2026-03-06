/**
 * Session Store - localStorage persistence for dApp sessions.
 * Stores ECIES keys and session metadata for reconnection.
 */

import type { DAppSession } from './types';
import { SessionStatus } from './types';

const STORAGE_KEY = 'qrlconnect:sessions';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class SessionStore {
  /**
   * Save a session to localStorage.
   */
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

  /**
   * Get all stored sessions, filtering out expired ones.
   */
  static getAll(): DAppSession[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];

      const sessions: DAppSession[] = JSON.parse(raw);
      const now = Date.now();

      // Filter out expired sessions
      const valid = sessions.filter(
        (s) => now - s.createdAt < SESSION_TTL_MS
      );

      // Clean up if we removed any
      if (valid.length !== sessions.length) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
      }

      return valid;
    } catch {
      return [];
    }
  }

  /**
   * Get a specific session by channel ID.
   */
  static get(channelId: string): DAppSession | null {
    return SessionStore.getAll().find((s) => s.id === channelId) || null;
  }

  /**
   * Remove a session.
   */
  static remove(channelId: string): void {
    const sessions = SessionStore.getAll().filter((s) => s.id !== channelId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }

  /**
   * Update session status.
   */
  static updateStatus(channelId: string, status: SessionStatus): void {
    const session = SessionStore.get(channelId);
    if (session) {
      session.status = status;
      session.lastActivity = Date.now();
      SessionStore.save(session);
    }
  }

  /**
   * Clear all sessions.
   */
  static clearAll(): void {
    localStorage.removeItem(STORAGE_KEY);
  }
}
