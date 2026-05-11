import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/auth.store';
import { useQueryStream } from '@/hooks/useQueryStream';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Send, RotateCcw, BookOpen, Loader2 } from 'lucide-react';
import type { Citation, Namespace } from '@ignis/shared';

// ── Confidence helpers ────────────────────────────────────────────────────────

function confidenceLabel(score: number): string {
  if (score >= 0.8) return 'High';
  if (score >= 0.5) return 'Medium';
  return 'Low';
}

function confidenceColor(score: number): string {
  if (score >= 0.8) return 'success';
  if (score >= 0.5) return 'warning';
  return 'destructive';
}

function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const variant = confidenceColor(score) as 'success' | 'warning' | 'destructive';
  return (
    <Badge variant={variant} className="text-xs tabular-nums gap-1">
      {confidenceLabel(score)} · {pct}%
    </Badge>
  );
}

// ── Citation bar (visual score bar) ──────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    score >= 0.8 ? 'bg-green-500' : score >= 0.5 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{pct}%</span>
    </div>
  );
}

// ── Citation card ─────────────────────────────────────────────────────────────

function CitationCard({ c }: { c: Citation }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border rounded-md p-3 text-sm space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-xs font-mono shrink-0">
          SOURCE {c.sourceId}
        </Badge>
        <span className="text-muted-foreground text-xs">{c.namespaceSlug}</span>
        <span className="font-medium text-xs truncate max-w-[200px]">{c.sourceFile}</span>
        {c.page != null && (
          <span className="text-muted-foreground text-xs">p.{c.page}</span>
        )}
        {c.score != null && <ConfidenceBadge score={c.score} />}
      </div>

      {c.score != null && <ScoreBar score={c.score} />}

      <p
        className={`text-muted-foreground text-xs leading-relaxed ${expanded ? '' : 'line-clamp-3'}`}
      >
        {c.chunkText}
      </p>
      {c.chunkText.length > 180 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-primary hover:underline"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function QueryPage() {
  const { tenant } = useAuthStore();
  const tenantId = tenant!.id;
  const { tokens, citations, overallConfidence, status, error, run, reset } =
    useQueryStream(tenantId);

  const [query, setQuery] = useState('');
  const [selectedNS, setSelectedNS] = useState<string[]>([]);

  const { data: namespaces = [] } = useQuery({
    queryKey: ['namespaces', tenantId],
    queryFn: () => api.listNamespaces(tenantId),
  });

  function toggleNS(id: string) {
    setSelectedNS((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
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
        {/* ── Query + Answer panel ── */}
        <div className="col-span-2 space-y-4">
          <form onSubmit={handleSubmit} className="space-y-3">
            <Textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What is the procedure for replacing the hydraulic filter?"
              rows={4}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey))
                  handleSubmit(e as unknown as React.FormEvent);
              }}
            />
            <div className="flex gap-2 items-center">
              <Button
                type="submit"
                disabled={!query.trim() || status === 'streaming'}
                className="gap-2"
              >
                {status === 'streaming' ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Send size={15} />
                )}
                {status === 'streaming' ? 'Generating…' : 'Ask'}
              </Button>
              {status !== 'idle' && (
                <Button type="button" variant="outline" onClick={reset} className="gap-2">
                  <RotateCcw size={15} /> Reset
                </Button>
              )}
              <p className="text-xs text-muted-foreground ml-2">⌘+Enter to submit</p>
            </div>
          </form>

          {/* ── Answer ── */}
          {(tokens || status === 'streaming') && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                  Answer
                  {status === 'streaming' && (
                    <Loader2 size={14} className="animate-spin text-muted-foreground" />
                  )}
                  {status === 'done' && (
                    <Badge variant="success" className="text-xs">Done</Badge>
                  )}
                  {status === 'done' && overallConfidence != null && (
                    <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                      Overall confidence:
                      <ConfidenceBadge score={overallConfidence} />
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Rendered markdown — streaming cursor appended while generating */}
                <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {tokens + (status === 'streaming' ? '▋' : '')}
                  </ReactMarkdown>
                </div>
              </CardContent>
            </Card>
          )}

          {error && (
            <div className="rounded-md bg-destructive/10 text-destructive px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {/* ── Citations ── */}
          {citations.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                  <BookOpen size={16} />
                  Sources ({citations.length})
                  {overallConfidence != null && (
                    <span className="text-xs font-normal text-muted-foreground ml-auto">
                      avg relevance:{' '}
                      <span className="font-medium">
                        {Math.round(overallConfidence * 100)}%
                      </span>
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {citations.map((c) => (
                  <CitationCard key={c.sourceId} c={c} />
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Namespace filter ── */}
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold mb-1">Filter Namespaces</h3>
            <p className="text-xs text-muted-foreground">
              Leave all unchecked to auto-route by similarity.
            </p>
          </div>
          <div className="space-y-2">
            {(namespaces as Namespace[])
              .filter((n) => n.active)
              .map((ns) => (
                <label
                  key={ns.id}
                  className={`flex items-start gap-2 p-2.5 rounded-md border cursor-pointer transition-colors ${
                    selectedNS.includes(ns.id)
                      ? 'border-primary bg-primary/5'
                      : 'hover:border-muted-foreground/30'
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
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {ns.description}
                    </p>
                  </div>
                </label>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
