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

function getInitials(name?: string, fallback = 'U'): string {
  if (!name) return fallback.slice(0, 2).toUpperCase();
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function ChannelBadge({ channel }: { channel: string }) {
  const isWa = channel.toLowerCase() === 'whatsapp';
  return (
    <span className={`pill ${isWa ? 'whatsapp' : 'telegram'}`}>
      {isWa ? '🟢 WhatsApp' : '🔵 Telegram'}
    </span>
  );
}

function ModeBadge({ mode, status }: { mode: Mode; status: string }) {
  if (status === 'closed') return <span className="pill">Closed</span>;
  if (mode === 'human') return <span className="pill human">👤 Human Operator</span>;
  if (mode === 'paused') return <span className="pill orange">⏸️ AI Paused</span>;
  return <span className="pill emerald">🤖 AI Active</span>;
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
      setNotice(result.delivered ? 'Reply sent successfully to customer.' : 'Reply saved. (Live channel delivery is processing)');
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
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>
            Live Conversations Inbox
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--fg-muted)' }}>
            Real-time customer chats from WhatsApp and Telegram. AI assists and hands over seamlessly.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {waitingCount > 0 && <span className="pill orange">⚡ {waitingCount} Needs Human</span>}
          <span className="pill">{conversations.length} Active Chats</span>
        </div>
      </div>

      {error && <div className="banner error" style={{ margin: 16 }}>{error}</div>}
      {notice && <div className="banner success" style={{ margin: 16 }}>{notice}</div>}

      <div className="inbox-layout">
        {/* Sidebar list */}
        <div className="inbox-sidebar">
          <div className="inbox-sidebar-head">
            <input
              className="inbox-search"
              placeholder="🔍 Search name, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
              <button
                className={`tab-btn ${filterMode === 'all' ? 'active' : ''}`}
                style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                onClick={() => setFilterMode('all')}
              >
                All ({conversations.length})
              </button>
              <button
                className={`tab-btn ${filterMode === 'human' ? 'active' : ''}`}
                style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                onClick={() => setFilterMode('human')}
              >
                Needs Action ({waitingCount})
              </button>
              <button
                className={`tab-btn ${filterMode === 'ai' ? 'active' : ''}`}
                style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                onClick={() => setFilterMode('ai')}
              >
                AI Auto
              </button>
            </div>
          </div>

          <div className="inbox-list">
            {filtered.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-muted)', fontSize: '0.85rem' }}>
                No matching conversations found.
              </div>
            ) : (
              filtered.map((c) => {
                const isSelected = c.sessionId === selected;
                const isWa = c.channel.toLowerCase() === 'whatsapp';
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
                    <div className={`inbox-item-avatar ${isWa ? 'whatsapp' : ''}`}>
                      {getInitials(c.displayName || c.externalUserId)}
                    </div>
                    <div className="inbox-item-content">
                      <div className="inbox-item-head">
                        <span className="inbox-item-name">{c.displayName || c.externalUserId}</span>
                        <span className="inbox-item-time">{fmtTime(c.lastMessageAt ?? c.updatedAt)}</span>
                      </div>
                      <div className="inbox-item-msg">
                        {c.lastMessage || 'No messages yet'}
                      </div>
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

        {/* Chat Thread Pane */}
        <div className="chat-pane">
          {!active ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}>
              Select a conversation from the left to inspect and reply.
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
                      {active.externalUserId} · <ChannelBadge channel={active.channel} /> · <ModeBadge mode={active.mode} status={active.status} />
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
                        onClick={() => act('/pause', 'AI paused for this customer.')}
                      >
                        ⏸️ Pause AI
                      </button>
                      <button
                        className="btn"
                        type="button"
                        disabled={busy}
                        onClick={() => act('/takeover', 'You took over! The AI is now silent.')}
                      >
                        ✋ Take Over
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn success"
                      type="button"
                      disabled={busy}
                      onClick={() => act('/handback', 'Conversation handed back to CosmIQ AI.')}
                    >
                      🤖 Hand Back to AI
                    </button>
                  )}
                </div>
              </div>

              <div className="chat-thread-stream">
                {messages.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--fg-muted)', marginTop: 40 }}>
                    No messages recorded yet in this session.
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
                            {isUser ? 'Customer' : isAi ? '🤖 CosmIQ AI' : '👤 Operator'}
                          </span>
                          <span>·</span>
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
                    placeholder="Type an instant reply (Enter to send, Shift+Enter for new line)..."
                    rows={2}
                  />
                  <button
                    className="btn"
                    type="submit"
                    disabled={busy || !draft.trim()}
                    style={{ height: 48, minWidth: 90 }}
                  >
                    {busy ? 'Sending…' : 'Send ➤'}
                  </button>
                </form>
                <div className="chat-status-tip">
                  {active.mode === 'ai' ? (
                    <span>💡 <strong>AI Active Mode:</strong> Gemini will automatically reply to customer messages. Take over to reply directly.</span>
                  ) : (
                    <span>⚠️ <strong>Operator Mode:</strong> AI is silent. Messages you send here will be delivered directly to the customer's WhatsApp.</span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
