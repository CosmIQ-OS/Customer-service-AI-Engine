import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export interface AdminNotification {
  id: number;
  kind: string;
  quote_id: number | null;
  intake_id: number | null;
  session_id: string | null;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface NotificationTarget {
  tab: 'quotes' | 'inbox' | 'intakes';
  intakeId?: number | null;
  sessionId?: string | null;
}

interface NotificationsPayload {
  notifications: AdminNotification[];
  unread: number;
}

const SOUND_PREF_KEY = 'cosmiq-notif-sound';
const DESKTOP_PREF_KEY = 'cosmiq-notif-desktop';
const BASE_TITLE = 'CosmIQ OS — Support & Quotation Workbench';

function readBoolPref(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === '1' || raw === 'true';
  } catch {
    return fallback;
  }
}

function writeBoolPref(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // ignore storage failures
  }
}

/** Plays a crisp, subtle 2-tone chime using Web Audio API (no external audio assets needed). */
export function playNotificationChime(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes = [
      { freq: 659.25, start: 0, dur: 0.14 }, // E5
      { freq: 880.0, start: 0.12, dur: 0.22 }, // A5
    ];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.freq, now + note.start);
      gain.gain.setValueAtTime(0.001, now + note.start);
      gain.gain.exponentialRampToValueAtTime(0.12, now + note.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + note.start);
      osc.stop(now + note.start + note.dur + 0.02);
    }

    setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, 500);
  } catch {
    // Autoplay policies may block audio before user gesture; fail silently.
  }
}

export function notificationTargetFor(item: AdminNotification): NotificationTarget | null {
  if (item.kind === 'conversation_message') {
    return { tab: 'inbox', sessionId: item.session_id };
  }
  if (item.kind === 'lead_started' && item.intake_id === null && item.session_id) {
    return { tab: 'inbox', sessionId: item.session_id };
  }
  if (item.kind === 'lead_started' || item.kind === 'lead_qualified' || item.kind === 'website_lead') {
    return { tab: 'intakes', intakeId: item.intake_id, sessionId: item.session_id };
  }
  if (item.quote_id !== null) {
    return { tab: 'quotes' };
  }
  return null;
}

export function useNotificationAlerts({
  refreshKey = 0,
  onNavigate,
  onNotificationArrived,
}: {
  refreshKey?: number;
  onNavigate?: (target: NotificationTarget) => void;
  onNotificationArrived?: (item: AdminNotification) => void;
}) {
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState<AdminNotification[]>([]);
  const [streamConnected, setStreamConnected] = useState(false);

  const [soundEnabled, setSoundEnabledState] = useState<boolean>(() => readBoolPref(SOUND_PREF_KEY, true));
  const [desktopEnabled, setDesktopEnabledState] = useState<boolean>(() => {
    const saved = readBoolPref(DESKTOP_PREF_KEY, false);
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    return saved && Notification.permission === 'granted';
  });
  const [desktopPermission, setDesktopPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission;
  });

  const seededRef = useRef(false);
  const seenIdsRef = useRef<Set<number>>(new Set());
  const soundRef = useRef(soundEnabled);
  const desktopRef = useRef(desktopEnabled);
  const onNavigateRef = useRef(onNavigate);
  const onArrivedRef = useRef(onNotificationArrived);

  soundRef.current = soundEnabled;
  desktopRef.current = desktopEnabled;
  onNavigateRef.current = onNavigate;
  onArrivedRef.current = onNotificationArrived;

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const triggerActiveAlert = useCallback(
    (item: AdminNotification) => {
      // Push live toast banner (max 4 visible at once)
      setToasts((prev) => {
        if (prev.some((t) => t.id === item.id)) return prev;
        return [item, ...prev].slice(0, 4);
      });
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== item.id));
      }, 9000);

      if (soundRef.current) {
        playNotificationChime();
      }

      if (
        desktopRef.current &&
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        try {
          const desktopNotif = new Notification(item.title, {
            body: item.body,
            tag: `cosmiq-notif-${item.id}`,
          });
          desktopNotif.onclick = () => {
            window.focus();
            const target = notificationTargetFor(item);
            if (target && onNavigateRef.current) {
              onNavigateRef.current(target);
            }
            desktopNotif.close();
          };
        } catch {
          // ignore desktop notification errors
        }
      }

      onArrivedRef.current?.(item);
    },
    [],
  );

  const load = useCallback(async () => {
    try {
      const data = await api<NotificationsPayload>('/api/notifications?limit=30');
      const items = data.notifications ?? [];
      setNotifications(items);
      setUnread(data.unread ?? 0);

      if (!seededRef.current) {
        for (const item of items) seenIdsRef.current.add(item.id);
        seededRef.current = true;
      } else {
        const newlyArrived = items.filter((item) => !item.read_at && !seenIdsRef.current.has(item.id));
        for (const item of items) seenIdsRef.current.add(item.id);
        for (const item of newlyArrived.reverse()) {
          triggerActiveAlert(item);
        }
      }
    } catch {
      // ignore transient poll failures
    }
  }, [triggerActiveAlert]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Real-time Server-Sent Events stream with automatic reconnect
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    let source: EventSource | null = null;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      source = new EventSource('/api/notifications/stream');

      source.addEventListener('ready', (event) => {
        setStreamConnected(true);
        try {
          const payload = JSON.parse((event as MessageEvent).data) as { unread?: number };
          if (typeof payload.unread === 'number') setUnread(payload.unread);
        } catch {
          // ignore
        }
      });

      source.addEventListener('notification', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as {
            notification: AdminNotification;
            unread?: number;
          };
          const incoming = payload.notification;
          if (!incoming || typeof incoming.id !== 'number') return;

          setNotifications((prev) => {
            const withoutDup = prev.filter((item) => item.id !== incoming.id);
            return [incoming, ...withoutDup].slice(0, 30);
          });
          if (typeof payload.unread === 'number') {
            setUnread(payload.unread);
          }

          if (!seenIdsRef.current.has(incoming.id)) {
            seenIdsRef.current.add(incoming.id);
            seededRef.current = true;
            if (!incoming.read_at) {
              triggerActiveAlert(incoming);
            }
          }
        } catch {
          // ignore malformed SSE payloads
        }
      });

      source.addEventListener('unread', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as { unread?: number };
          if (typeof payload.unread === 'number') setUnread(payload.unread);
        } catch {
          // ignore
        }
      });

      source.onerror = () => {
        setStreamConnected(false);
        source?.close();
        if (!closed && !reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, 5000);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      setStreamConnected(false);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [triggerActiveAlert]);

  // Keep browser tab title updated with unread count
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) ${BASE_TITLE}` : BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [unread]);

  const toggleSound = useCallback(() => {
    setSoundEnabledState((prev) => {
      const next = !prev;
      writeBoolPref(SOUND_PREF_KEY, next);
      if (next) playNotificationChime();
      return next;
    });
  }, []);

  const toggleDesktop = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setDesktopPermission('unsupported');
      return;
    }
    if (desktopEnabled) {
      setDesktopEnabledState(false);
      writeBoolPref(DESKTOP_PREF_KEY, false);
      return;
    }
    let perm = Notification.permission;
    if (perm === 'default') {
      perm = await Notification.requestPermission();
    }
    setDesktopPermission(perm);
    if (perm === 'granted') {
      setDesktopEnabledState(true);
      writeBoolPref(DESKTOP_PREF_KEY, true);
    } else {
      setDesktopEnabledState(false);
      writeBoolPref(DESKTOP_PREF_KEY, false);
    }
  }, [desktopEnabled]);

  const markRead = useCallback(
    async (id: number) => {
      await api(`/api/notifications/${id}/read`, { method: 'POST' }).catch(() => undefined);
      setToasts((prev) => prev.filter((item) => item.id !== id));
      await load();
    },
    [load],
  );

  const markAllRead = useCallback(async () => {
    await api('/api/notifications/read-all', { method: 'POST' });
    setToasts([]);
    await load();
  }, [load]);

  return {
    notifications,
    unread,
    toasts,
    streamConnected,
    soundEnabled,
    desktopEnabled,
    desktopPermission,
    load,
    toggleSound,
    toggleDesktop,
    markRead,
    markAllRead,
    dismissToast,
  };
}
