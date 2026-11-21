import type { AdminNotificationRecord } from '../db/repositories/notifications.js';

export type NotificationStreamEvent =
  | { type: 'notification'; notification: AdminNotificationRecord; unread: number }
  | { type: 'unread'; unread: number };

export type NotificationListener = (event: NotificationStreamEvent) => void;

/**
 * Lightweight in-process pub/sub hub used by the SSE endpoint (`/api/notifications/stream`)
 * to push newly created admin notifications to connected dashboard tabs in real time.
 */
export class NotificationHub {
  private readonly listeners = new Set<NotificationListener>();

  subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: NotificationStreamEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Individual SSE stream errors are handled by the subscriber cleanup.
      }
    }
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }
}
