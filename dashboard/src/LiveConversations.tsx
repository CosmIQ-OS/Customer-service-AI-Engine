import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';

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

/**
 * Clean markdown-aware renderer for chat messages.
 * Formats bold (**text**), bullet lists, and numbered lists cleanly.
 */
function FormattedMessage({ text }: { text: string }) {
  if (!text) return null;

  const lines = text.split('\n');
  const elements: ReactNode[] = [];
  let currentList: ReactNode[] = [];
  let isNumbered = false;

  const flushList = () => {
    if (currentList.length > 0) {
      if (isNumbered) {
        elements.push(
          <ol key={`ol-${elements.length}`} className="msg-list ordered">
            {currentList}
          </ol>
        );
      } else {
        elements.push(
          <ul key={`ul-${elements.length}`} className="msg-list">
            {currentList}
          </ul>
        );
      }
      currentList = [];
    }
  };

  const parseInline = (line: string): ReactNode[] => {
    const parts: ReactNode[] = [];
    const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.slice(lastIndex, match.index));
      }
      const boldText = match[1] || match[2];
      parts.push(<strong key={match.index}>{boldText}</strong>);
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < line.length) {
      parts.push(line.slice(lastIndex));
    }
    return parts;
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    const bulletMatch = trimmed.match(/^[\*\-•]\s+(.*)$/);
    const numMatch = trimmed.match(/^(\d+)[.)]\s+(.*)$/);

    if (bulletMatch) {
      if (isNumbered) flushList();
      isNumbered = false;
      currentList.push(<li key={`li-${idx}`}>{parseInline(bulletMatch[1])}</li>);
    } else if (numMatch) {
      if (!isNumbered) flushList();
      isNumbered = true;
      currentList.push(<li key={`li-${idx}`}>{parseInline(numMatch[2])}</li>);
    } else {
      flushList();
      if (trimmed === '') {
        elements.push(<div key={`sp-${idx}`} className="msg-spacer" />);
      } else {
        elements.push(
          <p key={`p-${idx}`} className="msg-p">
            {parseInline(trimmed)}
          </p>
        );
      }
    }
  });

  flushList();
  return <div className="msg-formatted">{elements}</div>;
}

interface LiveConversationsProps {
  onUnauthorized?: () => void;
}

export function LiveConversations({ onUnauthorized }: LiveConversationsProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'human' | 'ai'>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);

  const streamRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef<boolean>(true);
  const shouldScrollToBottomOnLoadRef = useRef<boolean>(true);
  const prevThreadIdRef = useRef<string | null>(null);
  const prevMsgCountRef = useRef<number>(0);
  const currentThreadIdRef = useRef<string | null>(null);

  const handleError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized?.();
        return;
      }
      setError(err instanceof Error ? err.message : 'Operation failed');
    },
    [onUnauthorized]
  );

  const loadList = useCallback(async () => {
    try {
      const payload = await api<{ conversations: Conversation[] }>('/api/conversations?limit=100');
      setConversations(payload.conversations);
      return payload.conversations;
    } catch (err) {
      handleError(err);
      return [];
    }
  }, [handleError]);

  const loadThread = useCallback(
    async (sessionId: string) => {
      try {
        const payload = await api<{ messages: Message[] }>(`/api/conversations/${sessionId}/messages`);
        if (currentThreadIdRef.current !== sessionId) {
          currentThreadIdRef.current = sessionId;
          setMessages(payload.messages);
        } else {
          setMessages((prev) => {
            if (prev.length === payload.messages.length) {
              const pLast = prev[prev.length - 1];
              const nLast = payload.messages[payload.messages.length - 1];
              if (pLast?.id === nLast?.id && pLast?.content === nLast?.content) {
                return prev;
              }
            }
            return payload.messages;
          });
        }
      } catch (err) {
        handleError(err);
      }
    },
    [handleError]
  );

  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  const handleScroll = useCallback(() => {
    if (!streamRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = streamRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const atBottom = distanceFromBottom <= 60;
    isAtBottomRef.current = atBottom;
    setShowScrollBottom(distanceFromBottom > 100);
    if (atBottom) {
      setHasNewMessagesBelow(false);
    }
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (!streamRef.current) return;
    if (behavior === 'auto') {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    } else {
      streamRef.current.scrollTo({
        top: streamRef.current.scrollHeight,
        behavior,
      });
    }
    isAtBottomRef.current = true;
    setShowScrollBottom(false);
    setHasNewMessagesBelow(false);
  }, []);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const rows = await loadList();
        if (!active) return;
        if (!selectedRef.current && rows.length > 0) {
          const first = rows.find((row) => row.mode !== 'ai')?.sessionId ?? rows[0]?.sessionId;
          if (first) setSelected(first);
        }
        const open = selectedRef.current;
        if (open) await loadThread(open);
      } catch (err) {
        if (active) handleError(err);
      }
    };
    void tick();
    const timer = setInterval(tick, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [loadList, loadThread, handleError]);

  useEffect(() => {
    if (!selected) {
      setMessages([]);
      currentThreadIdRef.current = null;
      return;
    }
    shouldScrollToBottomOnLoadRef.current = true;
    isAtBottomRef.current = true;
    setShowScrollBottom(false);
    setHasNewMessagesBelow(false);
    void loadThread(selected);
  }, [selected, loadThread]);

  useEffect(() => {
    if (!streamRef.current) return;

    const threadChanged = selected !== prevThreadIdRef.current;
    const newMessagesArrived = messages.length > prevMsgCountRef.current;

    prevThreadIdRef.current = selected;
    prevMsgCountRef.current = messages.length;

    if (threadChanged || shouldScrollToBottomOnLoadRef.current) {
      shouldScrollToBottomOnLoadRef.current = false;
      isAtBottomRef.current = true;
      setShowScrollBottom(false);
      setHasNewMessagesBelow(false);
      requestAnimationFrame(() => {
        if (streamRef.current) {
          streamRef.current.scrollTop = streamRef.current.scrollHeight;
        }
      });
      return;
    }

    if (newMessagesArrived) {
      if (isAtBottomRef.current) {
        requestAnimationFrame(() => {
          if (streamRef.current) {
            streamRef.current.scrollTo({
              top: streamRef.current.scrollHeight,
              behavior: 'smooth',
            });
          }
        });
      } else {
        // User is scrolled up reading earlier messages; do not hijack their scroll position
        setHasNewMessagesBelow(true);
        setShowScrollBottom(true);
      }
    }
  }, [messages, selected]);

  // Auto-clear notice after 4 seconds
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(t);
  }, [notice]);

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
      handleError(err);
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(event?: React.FormEvent) {
    if (event) event.preventDefault();
    if (!selected || !draft.trim()) return;
    shouldScrollToBottomOnLoadRef.current = true;
    isAtBottomRef.current = true;
    setShowScrollBottom(false);
    setHasNewMessagesBelow(false);
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
          : 'Reply stored; channel delivery pending.'
      );
      await loadThread(selected);
      await loadList();
      requestAnimationFrame(() => {
        if (streamRef.current) {
          streamRef.current.scrollTop = streamRef.current.scrollHeight;
        }
      });
    } catch (err) {
      handleError(err);
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
        <div className="inbox-header-title">
          <div className="kicker">TERMINAL // LIVE CONVERSATIONS</div>
          <h2>Enquiry &amp; Support Inbox</h2>
        </div>
        <div className="toolbar">
          {waitingCount > 0 && <span className="pill acc">{waitingCount} WAITING HUMAN</span>}
          <span className="pill">{conversations.length} ACTIVE CHATS</span>
        </div>
      </div>

      {error && (
        <div className="banner error" style={{ margin: '12px 16px 0' }}>
          <span>{error}</span>
          <button type="button" className="banner-close" onClick={() => setError('')}>
            ✕
          </button>
        </div>
      )}
      {notice && (
        <div className="banner success" style={{ margin: '12px 16px 0' }}>
          <span>{notice}</span>
          <button type="button" className="banner-close" onClick={() => setNotice('')}>
            ✕
          </button>
        </div>
      )}

      <div className="inbox-layout">
        {/* Conversation List Sidebar */}
        <div className={`inbox-sidebar ${mobileView === 'chat' ? 'mobile-hidden' : ''}`}>
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
                      setMobileView('chat');
                      void loadThread(c.sessionId);
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
        <div className={`chat-pane ${mobileView === 'list' ? 'mobile-hidden' : ''}`}>
          {!active ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 32,
              }}
              className="muted small"
            >
              Select a thread on the left to inspect transcript and handover status.
            </div>
          ) : (
            <>
              <div className="chat-pane-head">
                <div className="chat-user-info">
                  <button
                    type="button"
                    className="mobile-back-btn"
                    onClick={() => setMobileView('list')}
                    title="Back to all conversations"
                  >
                    ← INBOX
                  </button>
                  <div className="chat-user-avatar">
                    {getInitials(active.displayName || active.externalUserId)}
                  </div>
                  <div className="chat-user-title">
                    <h3>{active.displayName || active.externalUserId}</h3>
                    <div className="chat-user-meta">
                      <span className="mono">{active.externalUserId}</span>
                      <ChannelBadge channel={active.channel} />
                      <ModeBadge mode={active.mode} status={active.status} />
                    </div>
                  </div>
                </div>

                <div className="chat-pane-actions">
                  {active.mode === 'ai' ? (
                    <>
                      <button
                        className="btn secondary btn-sm"
                        type="button"
                        disabled={busy}
                        onClick={() => act('/pause', 'AI paused for this conversation.')}
                      >
                        PAUSE AI
                      </button>
                      <button
                        className="btn primary btn-sm"
                        type="button"
                        disabled={busy}
                        onClick={() => act('/takeover', 'Operator takeover active. AI is now silent.')}
                      >
                        TAKE OVER
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn success btn-sm"
                      type="button"
                      disabled={busy}
                      onClick={() => act('/handback', 'Conversation handed back to CosmIQ AI.')}
                    >
                      HAND BACK TO AI
                    </button>
                  )}
                </div>
              </div>

              <div className="chat-stream-wrapper">
                <div className="chat-thread-stream" ref={streamRef} onScroll={handleScroll}>
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
                          <div className="msg-bubble">
                            <FormattedMessage text={m.content} />
                          </div>
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
                </div>

                {showScrollBottom && (
                  <div className="chat-scroll-pill-wrap">
                    <button
                      type="button"
                      className={`chat-scroll-pill ${hasNewMessagesBelow ? 'has-new' : ''}`}
                      onClick={() => scrollToBottom('smooth')}
                      title="Scroll to latest messages"
                    >
                      <span className="scroll-pill-icon">↓</span>
                      <span>{hasNewMessagesBelow ? 'New messages' : 'Latest messages'}</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="chat-composer-box">
                <form className="chat-composer-form" onSubmit={sendReply}>
                  <textarea
                    className="chat-input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type an operator reply (Enter to send, Shift+Enter for newline)…"
                    rows={2}
                  />
                  <button
                    className="btn primary chat-send-btn"
                    type="submit"
                    disabled={busy || !draft.trim()}
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
