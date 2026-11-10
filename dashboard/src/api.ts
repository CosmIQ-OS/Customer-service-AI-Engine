export interface AdminMe {
  id: number;
  username: string;
  display_name: string;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body?: any) {
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
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    throw new ApiError(res.status, body?.error ?? text, body);
  }
  return res.json();
}
