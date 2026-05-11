import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Upload, FileText, RefreshCw, AlertCircle, CheckCircle2, Clock, RotateCcw, DatabaseZap } from 'lucide-react';
import type { Namespace, Document } from '@ignis/shared';

function StatusBadge({ status }: { status: Document['status'] }) {
  const map: Record<Document['status'], { variant: 'success' | 'warning' | 'secondary' | 'destructive'; icon: React.ReactNode }> = {
    indexed:    { variant: 'success',     icon: <CheckCircle2 size={11} /> },
    processing: { variant: 'warning',     icon: <RefreshCw size={11} className="animate-spin" /> },
    pending:    { variant: 'secondary',   icon: <Clock size={11} /> },
    failed:     { variant: 'destructive', icon: <AlertCircle size={11} /> },
  };
  const { variant, icon } = map[status] ?? map.pending;
  return (
    <Badge variant={variant} className="gap-1 shrink-0">
      {icon} {status}
    </Badge>
  );
}

export default function DocumentsPage() {
  const { tenant } = useAuthStore();
  const qc = useQueryClient();
  const tenantId = tenant!.id;

  const [selectedNS, setSelectedNS] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [pendingDocs, setPendingDocs] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: namespaces = [] } = useQuery({
    queryKey: ['namespaces', tenantId],
    queryFn: () => api.listNamespaces(tenantId),
  });

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['documents', tenantId, selectedNS],
    queryFn: () => api.listDocuments(tenantId, selectedNS),
    enabled: !!selectedNS,
    refetchInterval: pendingDocs.length > 0 ? 3000 : false,
  });

  // Auto-select first namespace
  useEffect(() => {
    if (namespaces.length && !selectedNS) setSelectedNS(namespaces[0].id);
  }, [namespaces]);

  // Remove completed docs from polling list
  useEffect(() => {
    const done = documents
      .filter((d: Document) => d.status === 'indexed' || d.status === 'failed')
      .map((d: Document) => d.id);
    if (done.length) setPendingDocs((ids) => ids.filter((id) => !done.includes(id)));
  }, [documents]);

  // ── Upload ──────────────────────────────────────────────────────────────────
  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedNS) return;
    setUploadError('');
    setUploading(true);
    try {
      const { document } = await api.uploadDocument(tenantId, selectedNS, file);
      setPendingDocs((ids) => [...ids, document.id]);
      qc.invalidateQueries({ queryKey: ['documents', tenantId, selectedNS] });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // ── Retry single doc ────────────────────────────────────────────────────────
  const retryMutation = useMutation({
    mutationFn: (documentId: string) =>
      api.retryDocument(tenantId, selectedNS, documentId),
    onSuccess: (_, documentId) => {
      setPendingDocs((ids) => [...ids, documentId]);
      qc.invalidateQueries({ queryKey: ['documents', tenantId, selectedNS] });
    },
  });

  // ── Re-index all ────────────────────────────────────────────────────────────
  const reindexMutation = useMutation({
    mutationFn: () => api.reindexNamespace(tenantId, selectedNS),
    onSuccess: (data) => {
      const allIds = documents.map((d: Document) => d.id);
      setPendingDocs(allIds);
      qc.invalidateQueries({ queryKey: ['documents', tenantId, selectedNS] });
      alert(`Re-index started for ${data.requeued} document(s).`);
    },
  });

  const ns = namespaces.find((n: Namespace) => n.id === selectedNS);
  const hasDocuments = documents.length > 0;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Documents</h1>
          <p className="text-sm text-muted-foreground mt-1">Upload and manage documents in your namespaces.</p>
        </div>
      </div>

      {/* Namespace selector + actions */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <label className="text-sm font-medium whitespace-nowrap">Namespace:</label>
        <select
          className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm flex-1 max-w-xs focus:outline-none focus:ring-2 focus:ring-ring"
          value={selectedNS}
          onChange={(e) => setSelectedNS(e.target.value)}
        >
          {namespaces.map((ns: Namespace) => (
            <option key={ns.id} value={ns.id}>{ns.name}</option>
          ))}
        </select>

        {selectedNS && (
          <>
            <input ref={fileRef} type="file" className="hidden"
              accept=".pdf,.txt,.md,.docx,.csv,.json" onChange={handleUpload} />
            <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Upload size={15} className="mr-2" />
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>

            {hasDocuments && (
              <Button
                variant="outline"
                onClick={() => reindexMutation.mutate()}
                disabled={reindexMutation.isPending}
                title="Re-embed all documents (use after changing embedding model or wiping Qdrant)"
              >
                <DatabaseZap size={15} className="mr-2" />
                {reindexMutation.isPending ? 'Queuing…' : 'Re-index All'}
              </Button>
            )}
          </>
        )}
      </div>

      {uploadError && (
        <div className="mb-4 flex items-center gap-2 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={15} /> {uploadError}
        </div>
      )}

      {ns && (
        <p className="text-xs text-muted-foreground mb-4 bg-muted/50 rounded-md px-3 py-2">
          <strong>Namespace:</strong> {ns.description}
        </p>
      )}

      {/* Document list */}
      {!selectedNS ? (
        <p className="text-center text-muted-foreground py-12">Select a namespace to view documents.</p>
      ) : isLoading ? (
        <p className="text-center text-muted-foreground py-12">Loading…</p>
      ) : !hasDocuments ? (
        <div className="text-center py-16 text-muted-foreground">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No documents yet</p>
          <p className="text-sm">Upload a PDF, TXT, MD, DOCX, CSV, or JSON file to get started.</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {documents.map((doc: Document) => (
            <Card key={doc.id}>
              <CardContent className="py-3 px-4 flex items-center gap-4">
                <FileText size={18} className="text-muted-foreground shrink-0" />

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{doc.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(doc.createdAt).toLocaleString()}
                    {doc.chunkCount ? ` · ${doc.chunkCount} chunks` : ''}
                  </p>
                  {doc.error && (
                    <p className="text-xs text-destructive mt-0.5 truncate" title={doc.error}>
                      {doc.error}
                    </p>
                  )}
                </div>

                <StatusBadge status={doc.status} />

                {/* Retry button — shown for failed OR indexed (re-embed) */}
                {(doc.status === 'failed' || doc.status === 'indexed') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    disabled={retryMutation.isPending && retryMutation.variables === doc.id}
                    onClick={() => retryMutation.mutate(doc.id)}
                    title={doc.status === 'failed' ? 'Retry ingestion' : 'Re-embed with current model'}
                  >
                    <RotateCcw size={14} className={
                      retryMutation.isPending && retryMutation.variables === doc.id
                        ? 'animate-spin' : ''
                    } />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
