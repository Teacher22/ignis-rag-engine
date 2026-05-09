import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/auth.store';
import { useQueryStream } from '@/hooks/useQueryStream';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Send, RotateCcw, BookOpen, Loader2 } from 'lucide-react';
import type { Namespace } from '@ignis/shared';

export default function QueryPage() {
  const { tenant } = useAuthStore();
  const tenantId = tenant!.id;
  const { tokens, citations, status, error, run, reset } = useQueryStream(tenantId);

  const [query, setQuery] = useState('');
  const [selectedNS, setSelectedNS] = useState<string[]>([]);

  const { data: namespaces = [] } = useQuery({
    queryKey: ['namespaces', tenantId],
    queryFn: () => api.listNamespaces(tenantId),
  });

  function toggleNS(id: string) {
    setSelectedNS((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || status === 'streaming') return;
    reset();
    await run(query.trim(), selectedNS.length ? selectedNS : undefined);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Query Playground</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Ask questions across your namespaces. Responses stream token-by-token with source citations.
      </p>

      <div className="grid grid-cols-3 gap-6">
        {/* Query panel */}
        <div className="col-span-2 space-y-4">
          <form onSubmit={handleSubmit} className="space-y-3">
            <Textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What is the procedure for replacing the hydraulic filter?"
              rows={4}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(e as unknown as React.FormEvent);
              }}
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={!query.trim() || status === 'streaming'} className="gap-2">
                {status === 'streaming' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                {status === 'streaming' ? 'Generating…' : 'Ask'}
              </Button>
              {status !== 'idle' && (
                <Button type="button" variant="outline" onClick={reset} className="gap-2">
                  <RotateCcw size={15} /> Reset
                </Button>
              )}
              <p className="text-xs text-muted-foreground self-center ml-2">⌘+Enter to submit</p>
            </div>
          </form>

          {/* Answer */}
          {(tokens || status === 'streaming') && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  Answer
                  {status === 'streaming' && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
                  {status === 'done' && <Badge variant="success" className="text-xs">Done</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm max-w-none whitespace-pre-wrap font-mono text-sm leading-relaxed">
                  {tokens}
                  {status === 'streaming' && <span className="animate-pulse">▋</span>}
                </div>
              </CardContent>
            </Card>
          )}

          {error && (
            <div className="rounded-md bg-destructive/10 text-destructive px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {/* Citations */}
          {citations.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <BookOpen size={16} /> Sources ({citations.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {citations.map((c) => (
                  <div key={c.sourceId} className="border rounded-md p-3 text-sm">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Badge variant="outline" className="text-xs font-mono">SOURCE {c.sourceId}</Badge>
                      <span className="text-muted-foreground text-xs">{c.namespaceSlug}</span>
                      <span className="font-medium text-xs">{c.sourceFile}</span>
                      {c.page && <span className="text-muted-foreground text-xs">p.{c.page}</span>}
                    </div>
                    <p className="text-muted-foreground text-xs line-clamp-3">{c.chunkText}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Namespace filter */}
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold mb-1">Filter Namespaces</h3>
            <p className="text-xs text-muted-foreground">Leave all unchecked to auto-route by similarity.</p>
          </div>
          <div className="space-y-2">
            {(namespaces as Namespace[]).filter((n) => n.active).map((ns) => (
              <label
                key={ns.id}
                className={`flex items-start gap-2 p-2.5 rounded-md border cursor-pointer transition-colors ${
                  selectedNS.includes(ns.id) ? 'border-primary bg-primary/5' : 'hover:border-muted-foreground/30'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedNS.includes(ns.id)}
                  onChange={() => toggleNS(ns.id)}
                  className="mt-0.5 accent-primary"
                />
                <div>
                  <p className="text-sm font-medium leading-none">{ns.name}</p>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{ns.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
