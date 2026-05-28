import { apiRequest } from './client';

export type SseProgressEvent = { type: 'progress'; message: string };
export type SseCompleteEvent = { type: 'complete'; data: unknown };
export type SseErrorEvent   = { type: 'error'; message: string };
export type SseEvent = SseProgressEvent | SseCompleteEvent | SseErrorEvent;

type SseCallbacks = {
  onProgress?: (message: string) => void;
  onComplete?: (data: unknown) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
};

export async function streamSSE(
  path: string,
  body: unknown,
  callbacks: SseCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const res = await apiRequest(path, {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    callbacks.onError?.(`请求失败 HTTP ${res.status}: ${text.slice(0, 200)}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') {
          callbacks.onDone?.();
          return;
        }
        try {
          const evt = JSON.parse(raw) as SseEvent;
          if (evt.type === 'progress') callbacks.onProgress?.(evt.message);
          else if (evt.type === 'complete') callbacks.onComplete?.(evt.data);
          else if (evt.type === 'error') callbacks.onError?.(evt.message);
        } catch {
          // Ignore malformed events
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
    callbacks.onDone?.();
  }
}
