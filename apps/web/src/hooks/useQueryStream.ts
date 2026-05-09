import { useState, useCallback } from 'react';
import { Citation } from '@ignis/shared';
import { useAuthStore } from '../stores/auth.store';

type Status = 'idle' | 'streaming' | 'done' | 'error';

export function useQueryStream(tenantId: string) {
  const [tokens, setTokens] = useState('');
  const [citations, setCitations] = useState<Citation[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (query: string, namespaceIds?: string[]) => {
      setStatus('streaming');
      setTokens('');
      setCitations([]);
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
            namespace_ids: namespaceIds,
            stream: true,
          }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${response.status}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value, { stream: true });
          const lines = text.split('\n');

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6)) as
                | { token: string }
                | { done: true; citations: Citation[] }
                | { error: string };

              if ('token' in data) {
                setTokens((prev) => prev + data.token);
              } else if ('done' in data && data.done) {
                setCitations(data.citations);
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
    setStatus('idle');
    setError(null);
  }, []);

  return { tokens, citations, status, error, run, reset };
}
