export type ChannelName = 'telegram' | 'whatsapp' | 'web' | 'api' | (string & {});

export interface ServiceRecord {
  id: number;
  name: string;
  description: string;
  category: string;
  status: 'available' | 'unavailable' | 'limited' | 'maintenance';
  availability_note: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface FaqRecord {
  id: number;
  question: string;
  answer: string;
  tags: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChatRequestRecord {
  id: number;
  channel: string;
  external_user_id: string;
  session_id: string | null;
  kind: string;
  subject: string;
  body: string;
  status: string;
  resolution: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ChatLogRecord {
  id: number;
  request_id: number | null;
  channel: string;
  external_user_id: string;
  session_id: string | null;
  direction: 'inbound' | 'outbound' | 'system';
  event: string;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface SessionRecord {
  id: string;
  channel: string;
  external_user_id: string;
  context: Record<string, unknown>;
  last_intent: string;
  status: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRecord {
  id: number;
  session_id: string;
  channel: string;
  external_user_id: string;
  role: 'user' | 'assistant' | 'human';
  content: string;
  tokens: number;
  tenant_id: string;
  created_at: string;
}

export interface TraceRecord {
  id: number;
  session_id: string;
  message_id: number | null;
  model: string;
  prompt_version: string;
  steps: number;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  tool_calls: Array<Record<string, unknown>>;
  error: string;
  tenant_id: string;
  created_at: string;
}

export interface InboundMessage {
  channel: ChannelName;
  externalUserId: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface EngineResponse {
  reply: string;
  intent: string;
  sessionId: string;
  requestId?: number;
  data?: Record<string, unknown>;
}
