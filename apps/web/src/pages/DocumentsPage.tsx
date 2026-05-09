import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Upload, FileText, RefreshCw, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import type { Namespace, Document } from '@ignis/shared';

function StatusBadge({ status }: { status: Document['status'] }) {
  const map: Record<Document['status'], { variant: 'success' | 'warning' | 'secondary' | 'destructive'; icon: React.ReactNode }> = {
    indexed: { variant: 'success', icon: <CheckCircle2 size={11} /> },
    processing: { variant: 'warning', icon: <RefreshCw size={11} className="animate-spin" /> },
    pending: { variant: 'secondary', icon: <Clock size={11} /> },
    failed: { variant: 'destructive', icon: <AlertCircle size={11} /> },
  };
  const { variant, icon } = map[status] ?? map.pending;
  return (
    <Badge variant={variant} className="gap-1">
      {icon} {status}
    </Badge>
  );
}

export default function DocumentsPage() {
  const { tenant } = useAuthStore();
  const qc = useQueryClient();
  const tenantId = tenant!.id;

  const [selectedNS, setSelectedNS] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [pendingJobs, setPendingJobs] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: namespaces = [] } = useQuery({
    queryKey: ['namespaces', tenantId],
    queryFn: () => api.listNamespaces(tenantId),
  });

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['documents', tenantId, selectedNS],
    queryFn: () => api.listDocuments(tenantId, selectedNS),
    enabled: !!selectedNS,
    refetchInterval: pendingJobs.length > 0 ? 3000 : false,
  });

  // Auto-select first namespace
  useEffect(() => {
    if (namespaces.length && !selectedNS) setSelectedNS(namespaces[0].id);
  }, [namespaces]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedNS) return;
    setUploadError('');
    setUploading(true);
    try {
      const { jobId } = await api.uploadDocument(tenantId, selectedNS, file);
      setPendingJobs((j) => [...j, jobId]);
      qc.invalidateQueries({ queryKey: ['documents', tenantId, selectedNS] });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // Remove completed jobs from polling list
  useEffect(() => {
    const completed = documents
      .filter((d) => d.status === 'indexed' || d.status === 'failed')
      .map((d) => d.id);
    if (completed.length) {
      setPendingJobs((jobs) => jobs.filter((j) => !completed.some(() => true)));
    }
  }, [documents]);

  const ns = namespaces.find((n: Namespace) => n.id === selectedNS);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Documents</h1>
          <p className="text-sm text-muted-foreground mt-1">Upload and manage documents in your namespaces.</p>
        </div>
      </div>

      {/* Namespace selector */}
      <div className="flex items-center gap-3 mb-6">
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
            <input ref={fileRef} type="file" className="hidden" accept=".pdf,.txt,.md,.docx,.csv,.json" onChange={handleUpload} />
            <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Upload size={15} className="mr-2" />
              {uploading ? 'Uploading…' : 'Upload Document'}
            </Button>
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

      {!selectedNS ? (
        <p className="text-center text-muted-foreground py-12">Select a namespace to view documents.</p>
      ) : isLoading ? (
        <p className="text-center text-muted-foreground py-12">Loading…</p>
      ) : documents.length === 0 ? (
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
                  {doc.error && <p className="text-xs text-destructive mt-0.5">{doc.error}</p>}
                </div>
                <StatusBadge status={doc.status} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
