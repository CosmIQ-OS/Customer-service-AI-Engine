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
  return isNaN(d.getTime()) ? v : d.toLocaleTimeString();
}

function modePill(mode: Mode, status: string) {
  if (status === 'closed') return <span className="pill">closed</span>;
  if (mode === 'human') return <span className="pill black">human</span>;
  if (mode === 'paused') return <span className="pill orange">ai paused</span>;
  return <span className="pill">ai</span>;
}

export function LiveConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  const loadList = useCallback(async () => {
    const payload = await api<{ conversations: Conversation[] }>('/api/conversations?limit=100');
    setConversations(payload.conversations);
    return payload.conversations;
  }, []);

  const loadThread = useCallback(async (sessionId: string) => {
    const payload = await api<{ messages: Message[] }>(`/api/conversations/${sessionId}/messages`);
    setMessages(payload.messages);
  }, []);

  // The selected conversation is kept in a ref so the polling tick can refresh
  // the open thread without re-running the effect that selects a conversation.
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
    const timer = setInterval(tick, 5000);
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

  async function sendReply(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !draft.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ delivered: boolean }>(`/api/conversations/${selected}/reply`, {
        method: 'POST',
        body: JSON.stringify({ text: draft.trim() }),
      });
      setDraft('');
      setNotice(result.delivered ? 'Reply sent to the customer.' : 'Reply stored; channel delivery is pending.');
      await loadThread(selected);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the reply');
    } finally {
      setBusy(false);
    }
  }

  const active = conversations.find((row) => row.sessionId === selected);
  const waiting = conversations.filter((row) => row.status === 'open' && row.mode !== 'ai');

  return (
    <section className="card">
      <h2 className="panel-title">
        Live Conversations <span>WhatsApp-style inbox · AI pauses when a human takes over</span>
      </h2>

      <div className="toolbar" style={{ marginBottom: 10 }}>
        <span className="pill orange">{waiting.length} waiting for a human</span>
        <span className="pill">{conversations.length} total</span>
        <span className="muted small">Idle conversations close automatically after 60 minutes.</span>
      </div>

      {error && <div className="card error" style={{ marginBottom: 12 }}>{error}</div>}
      {notice && <div className="success" style={{ marginBottom: 12 }}>{notice}</div>}

      <div className="chat-layout">
        <div className="chat-list" ref={listRef}>
          {conversations.length === 0 ? (
            <div className="muted small">No conversations yet. Send a simulated chat message to start one.</div>
          ) : (
            conversations.map((conversation) => (
              <button
                key={conversation.sessionId}
                type="button"
                className={`chat-list-item ${conversation.sessionId === selected ? 'active' : ''}`}
                onClick={() => {
                  setSelected(conversation.sessionId);
                  void loadThread(conversation.sessionId).catch(() => undefined);
                }}
              >
                <div className="chat-list-head">
                  <strong>{conversation.displayName || conversation.externalUserId}</strong>
                  {modePill(conversation.mode, conversation.status)}
                </div>
                <div className="muted small">
                  {conversation.channel} · {conversation.externalUserId}
                </div>
                <div className="chat-preview">{conversation.lastMessage || 'No messages yet.'}</div>
                <div className="muted small">
                  {fmtTime(conversation.lastMessageAt ?? conversation.updatedAt)}
                  {conversation.unreadCount > 0 ? ` · ${conversation.unreadCount} unread` : ''}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="chat-thread">
          {!active ? (
            <div className="muted small">Select a conversation to read it.</div>
          ) : (
            <>
              <div className="chat-thread-head">
                <div>
                  <strong>{active.displayName || active.externalUserId}</strong>
                  <div className="muted small">
                    {active.channel} · {active.externalUserId} · {modePill(active.mode, active.status)}
                  </div>
                </div>
                <div className="toolbar">
                  {active.mode === 'ai' ? (
                    <button className="btn secondary" type="button" disabled={busy} onClick={() => act('/pause', 'AI paused for this conversation.')}>
                      Pause AI
                    </button>
                  ) : (
                    <button className="btn secondary" type="button" disabled={busy} onClick={() => act('/handback', 'Conversation handed back to the AI.')}>
                      Hand back to AI
                    </button>
                  )}
                  {active.mode !== 'human' && (
                    <button className="btn" type="button" disabled={busy} onClick={() => act('/takeover', 'You now own this conversation.')}>
                      Take over
                    </button>
                  )}
                </div>
              </div>

              <div className="chat-messages">
                {messages.length === 0 ? (
                  <div className="muted small">No messages in this conversation yet.</div>
                ) : (
                  messages.map((message) => (
                    <div key={message.id} className={`chat-bubble ${message.role}`}>
                      <div className="chat-bubble-role">
                        {message.role === 'user' ? 'Customer' : message.role === 'human' ? 'You' : 'AI'} · {fmtTime(message.created_at)}
                      </div>
                      <div>{message.content}</div>
                    </div>
                  ))
                )}
              </div>

              <form className="chat-composer" onSubmit={sendReply}>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Reply to the customer…"
                  rows={2}
                />
                <button className="btn" type="submit" disabled={busy || !draft.trim()}>
                  {busy ? 'Sending…' : 'Send'}
                </button>
              </form>
              <p className="muted small">
                {active.mode === 'ai'
                  ? 'The AI is answering this conversation. Take over to reply manually.'
                  : 'The AI stays silent while you own this conversation.'}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
