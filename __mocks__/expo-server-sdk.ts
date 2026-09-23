/**
 * Jest stand-in for expo-server-sdk (pure ESM, which ts-jest cannot load).
 * Production code reaches the real SDK through a dynamic import; tests that
 * never send a push never reach this either. Tests that DO send get tickets
 * back and can assert on what was passed.
 */
export class Expo {
  static isExpoPushToken(t: string): boolean { return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(t); }
  chunkPushNotifications<T>(m: T[]): T[][] { return m.length ? [m] : []; }
  chunkPushNotificationReceiptIds(ids: string[]): string[][] { return ids.length ? [ids] : []; }
  async sendPushNotificationsAsync(m: { to: string }[]) { return m.map((_, i) => ({ status: 'ok' as const, id: `ticket-${i}` })); }
  async getPushNotificationReceiptsAsync(ids: string[]) { return Object.fromEntries(ids.map((id) => [id, { status: 'ok' as const }])); }
}
export type ExpoPushMessage = { to: string; title?: string; body?: string; data?: Record<string, string>; sound?: string; channelId?: string };
export type ExpoPushTicket = { status: 'ok'; id: string } | { status: 'error'; message: string; details?: { error?: string } };
