import { useAuthStore } from '../stores/auth-store';
import { useSettingsStore } from '../stores/settings-store';

export async function apiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const baseUrl = useSettingsStore.getState().apiBaseUrl;
  const token   = useAuthStore.getState().accessToken;

  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiRequest(path, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await apiRequest(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}
