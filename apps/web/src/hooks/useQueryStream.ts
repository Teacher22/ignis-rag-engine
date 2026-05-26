import { useState, useCallback } from 'react';
import { Citation } from '@ignis/shared';
import { useAuthStore } from '../stores/auth.store';

type Status = 'idle' | 'streaming' | 'done' | 'error';

export function useQueryStream(tenantId: string) {
  const [tokens, setTokens] = useState('');
  const [citations, setCitations] = useState<Citation[]>([]);
  const [overallConfidence, setOverallConfidence] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (query: string, namespaceIds?: string[]) => {
      setStatus('streaming');
      setTokens('');
      setCitations([]);
      setOverallConfidence(null);
      setError(null);

      try {
        const token = useAuthStore.getState().token;
        const response = await fetch(`/api/v1/tenants/${tenantId}/query`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            query,
            namespaceIds: namespaceIds,
            stream: true,
          }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${response.status}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(trimmed.slice(6)) as
                | { token: string }
                | { done: true; citations: Citation[]; overallConfidence?: number }
                | { error: string };

              if ('token' in data) {
                setTokens((prev) => prev + data.token);
              } else if ('done' in data && data.done) {
                setCitations(data.citations);
                setOverallConfidence(data.overallConfidence ?? null);
                setStatus('done');
              } else if ('error' in data) {
                throw new Error(data.error);
              }
            } catch {
              // skip malformed lines
            }
          }
        }

        if (status !== 'done') setStatus('done');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(msg);
        setStatus('error');
      }
    },
    [tenantId]
  );

  const reset = useCallback(() => {
    setTokens('');
    setCitations([]);
    setOverallConfidence(null);
    setStatus('idle');
    setError(null);
  }, []);

  return { tokens, citations, overallConfidence, status, error, run, reset };
}
