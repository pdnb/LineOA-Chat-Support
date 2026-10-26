const TOKEN_KEY = 'cc.token';
/** Set while the session came from Auth0, so logout also ends the Auth0 session. */
const SSO_KEY = 'cc.sso';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null, sso = false) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
    if (token && sso) localStorage.setItem(SSO_KEY, '1');
    else localStorage.removeItem(SSO_KEY);
  } catch {
    // storage unavailable: session lasts until reload
  }
}

export function isSsoSession(): boolean {
  try {
    return localStorage.getItem(SSO_KEY) === '1';
  } catch {
    return false;
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, headers, body });
  if (res.status === 401 && token) {
    setToken(null);
    window.location.assign('/login');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join(', ') : data?.message;
    throw new ApiError(res.status, msg ?? `HTTP ${res.status}`);
  }
  return data as T;
}
