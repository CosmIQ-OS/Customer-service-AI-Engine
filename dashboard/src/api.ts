export interface AdminMe {
  id: number;
  username: string;
  display_name: string;
}

export interface ApiErrorBody {
  error?: string;
  code?: string;
  errors?: Array<{ row: number; message: string }>;
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: ApiErrorBody,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    let body: ApiErrorBody | undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      body = parsed && typeof parsed === 'object' ? (parsed as ApiErrorBody) : undefined;
    } catch {
      body = undefined;
    }
    throw new ApiError(res.status, typeof body?.error === 'string' ? body.error : text, body);
  }
  return res.json() as Promise<T>;
}
