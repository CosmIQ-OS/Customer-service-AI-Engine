import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

type Mode = 'ai' | 'human' | 'paused';

interface Conversation {
  sessionId: string;
  channel: string;
  externalUserId: string;
  displayName: string;
  mode: Mode;
  status: 'open' | 'closed';
  takenOverBy: number | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  idleDeadlineAt: string | null;
  unreadCount: number;
  closedReason: string;
  updatedAt: string;
  lastMessage: string;
  lastMessageRole: string;
  lastMessageAt: string | null;
}

interface Message {
  id: number;
  role: 'user' | 'assistant' | 'human';
  content: string;
  created_at: string;
}

function fmtTime(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v.includes('Z') ? v : v.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? v : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getInitials(name?: string, fallback = 'US'): string {
  if (!name) return fallback.slice(0, 2).toUpperCase();
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function ChannelBadge({ channel }: { channel: string }) {
  const normalized = channel.toLowerCase();
  return (
    <span className={`pill ${normalized === 'whatsapp' ? 'whatsapp' : 'telegram'}`}>
      {normalized === 'whatsapp' ? 'WHATSAPP' : normalized === 'telegram' ? 'TELEGRAM' : normalized.toUpperCase()}
    </span>
  );
}

function ModeBadge({ mode, status }: { mode: Mode; status: string }) {
  if (status === 'closed') return <span className="pill">CLOSED</span>;
  if (mode === 'human') return <span className="pill black">HUMAN OPERATOR</span>;
  if (mode === 'paused') return <span className="pill acc">PAUSED</span>;
  return <span className="pill ok">AI ACTIVE</span>;
}

export function LiveConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'human' | 'ai'>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const loadList = useCallback(async () => {
    const payload = await api<{ conversations: Conversation[] }>('/api/conversations?limit=100');
    setConversations(payload.conversations);
    return payload.conversations;
  }, []);

  const loadThread = useCallback(async (sessionId: string) => {
    const payload = await api<{ messages: Message[] }>(`/api/conversations/${sessionId}/messages`);
    setMessages(payload.messages);
  }, []);

  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const rows = await loadList();
        if (!active) return;
        setSelected((current) => current ?? rows.find((row) => row.mode !== 'ai')?.sessionId ?? rows[0]?.sessionId ?? null);
        const open = selectedRef.current;
        if (open) await loadThread(open);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Could not load conversations');
      }
    };
    void tick();
    const timer = setInterval(tick, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [loadList, loadThread]);

  useEffect(() => {
    if (!selected) {
      setMessages([]);
      return;
    }
    void loadThread(selected).catch(() => undefined);
  }, [selected, loadThread]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function act(path: string, label: string) {
    if (!selected) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/api/conversations/${selected}${path}`, { method: 'POST' });
      setNotice(label);
      await loadList();
      await loadThread(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The action failed');
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(event?: React.FormEvent) {
    if (event) event.preventDefault();
    if (!selected || !draft.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ delivered: boolean }>(`/api/conversations/${selected}/reply`, {
        method: 'POST',
        body: JSON.stringify({ text: draft.trim() }),
      });
      setDraft('');
      setNotice(
        result.delivered
          ? 'Reply delivered to the customer channel.'
          : 'Reply stored; channel delivery pending.',
      );
      await loadThread(selected);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the reply');
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendReply();
    }
  }

  const active = conversations.find((row) => row.sessionId === selected);
  const waitingCount = conversations.filter((row) => row.status === 'open' && row.mode !== 'ai').length;

  const filtered = conversations.filter((c) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      c.displayName?.toLowerCase().includes(q) ||
      c.externalUserId.toLowerCase().includes(q) ||
      c.lastMessage?.toLowerCase().includes(q);

    if (!matchSearch) return false;
    if (filterMode === 'human') return c.mode === 'human' || c.mode === 'paused';
    if (filterMode === 'ai') return c.mode === 'ai';
    return true;
  });

  return (
    <section className="inbox-card">
      <div className="inbox-header">
        <div>
          <div className="kicker">TERMINAL // LIVE CONVERSATIONS</div>
          <h2 style={{ margin: '4px 0 0', fontSize: '1.05rem', fontWeight: 600 }}>
            Enquiry &amp; Support Inbox
          </h2>
        </div>
        <div className="toolbar">
          {waitingCount > 0 && <span className="pill acc">{waitingCount} WAITING HUMAN</span>}
          <span className="pill">{conversations.length} ACTIVE CHATS</span>
        </div>
      </div>

      {error && (
        <div className="banner error" style={{ margin: '12px 16px 0' }}>
          {error}
        </div>
      )}
      {notice && (
        <div className="banner success" style={{ margin: '12px 16px 0' }}>
          {notice}
        </div>
      )}

      <div className="inbox-layout">
        {/* Conversation List Sidebar */}
        <div className="inbox-sidebar">
          <div className="inbox-sidebar-head">
            <input
              className="inbox-search"
              placeholder="Filter name, phone ID, or text…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="inbox-filter-strip">
              <button
                type="button"
                className={`inbox-filter-btn ${filterMode === 'all' ? 'active' : ''}`}
                onClick={() => setFilterMode('all')}
              >
                ALL ({conversations.length})
              </button>
              <button
                type="button"
                className={`inbox-filter-btn ${filterMode === 'human' ? 'active' : ''}`}
                onClick={() => setFilterMode('human')}
              >
                ACTION ({waitingCount})
              </button>
              <button
                type="button"
                className={`inbox-filter-btn ${filterMode === 'ai' ? 'active' : ''}`}
                onClick={() => setFilterMode('ai')}
              >
                AI AUTO
              </button>
            </div>
          </div>

          <div className="inbox-list">
            {filtered.length === 0 ? (
              <div className="muted small" style={{ padding: 24, textAlign: 'center' }}>
                No matching conversations found.
              </div>
            ) : (
              filtered.map((c) => {
                const isSelected = c.sessionId === selected;
                return (
                  <button
                    key={c.sessionId}
                    type="button"
                    className={`inbox-item ${isSelected ? 'active' : ''}`}
                    onClick={() => {
                      setSelected(c.sessionId);
                      void loadThread(c.sessionId).catch(() => undefined);
                    }}
                  >
                    <div className="inbox-item-avatar">
                      {getInitials(c.displayName || c.externalUserId)}
                    </div>
                    <div className="inbox-item-content">
                      <div className="inbox-item-head">
                        <span className="inbox-item-name">{c.displayName || c.externalUserId}</span>
                        <span className="inbox-item-time">{fmtTime(c.lastMessageAt ?? c.updatedAt)}</span>
                      </div>
                      <div className="inbox-item-msg">{c.lastMessage || 'No messages yet'}</div>
                      <div className="inbox-item-meta">
                        <ChannelBadge channel={c.channel} />
                        <ModeBadge mode={c.mode} status={c.status} />
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Thread Detail Pane */}
        <div className="chat-pane">
          {!active ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }} className="muted small">
              Select a thread on the left to inspect transcript and handover status.
            </div>
          ) : (
            <>
              <div className="chat-pane-head">
                <div className="chat-user-info">
                  <div className="chat-user-avatar">
                    {getInitials(active.displayName || active.externalUserId)}
                  </div>
                  <div className="chat-user-title">
                    <h3>{active.displayName || active.externalUserId}</h3>
                    <p>
                      <span className="mono">{active.externalUserId}</span>
                      <ChannelBadge channel={active.channel} />
                      <ModeBadge mode={active.mode} status={active.status} />
                    </p>
                  </div>
                </div>

                <div className="toolbar">
                  {active.mode === 'ai' ? (
                    <>
                      <button
                        className="btn secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => act('/pause', 'AI paused for this conversation.')}
                      >
                        PAUSE AI
                      </button>
                      <button
                        className="btn primary"
                        type="button"
                        disabled={busy}
                        onClick={() => act('/takeover', 'Operator takeover active. AI is now silent.')}
                      >
                        TAKE OVER
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn success"
                      type="button"
                      disabled={busy}
                      onClick={() => act('/handback', 'Conversation handed back to CosmIQ AI.')}
                    >
                      HAND BACK TO AI
                    </button>
                  )}
                </div>
              </div>

              <div className="chat-thread-stream">
                {messages.length === 0 ? (
                  <div className="muted small" style={{ textAlign: 'center', marginTop: 40 }}>
                    No messages recorded in this session yet.
                  </div>
                ) : (
                  messages.map((m) => {
                    const isUser = m.role === 'user';
                    const isAi = m.role === 'assistant';
                    return (
                      <div key={m.id} className={`msg-row ${m.role}`}>
                        <div className="msg-bubble">{m.content}</div>
                        <div className="msg-meta">
                          <span className="msg-role-tag">
                            {isUser ? 'CUSTOMER' : isAi ? 'COSMIQ AI' : 'OPERATOR'}
                          </span>
                          <span>//</span>
                          <span>{fmtTime(m.created_at)}</span>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="chat-composer-box">
                <form className="chat-composer-form" onSubmit={sendReply}>
                  <textarea
                    className="chat-input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type an operator reply (Enter to send, Shift+Enter for new line)…"
                    rows={2}
                  />
                  <button
                    className="btn primary"
                    type="submit"
                    disabled={busy || !draft.trim()}
                    style={{ height: 48, minWidth: 100 }}
                  >
                    {busy ? 'SENDING…' : 'SEND'}
                  </button>
                </form>
                <div className="chat-status-tip">
                  {active.mode === 'ai'
                    ? 'STATUS // AI ACTIVE: Automated responses enabled. Click TAKE OVER to reply manually.'
                    : 'STATUS // OPERATOR CONTROL: AI paused. Replies dispatch directly to channel.'}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
