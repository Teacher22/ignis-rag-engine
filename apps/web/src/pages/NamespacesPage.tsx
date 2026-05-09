import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Pencil, Trash2, Zap } from 'lucide-react';
import type { Namespace } from '@ignis/shared';

const MIN_DESC_LEN = 50;
const MAX_DESC_LEN = 500;

function DescriptionQualityHint({ desc }: { desc: string }) {
  const len = desc.length;
  if (len === 0) return null;
  if (len < MIN_DESC_LEN)
    return (
      <p className="text-xs text-yellow-600 mt-1">
        ⚠ Description is too short ({len}/{MIN_DESC_LEN} min). Short descriptions hurt routing accuracy.
        Try: "Use this to answer questions about…"
      </p>
    );
  if (len < 100)
    return (
      <p className="text-xs text-blue-600 mt-1">
        💡 Tip: Be more specific — include key terms, product names, or acronyms for better routing.
      </p>
    );
  return <p className="text-xs text-green-600 mt-1">✓ Good description length</p>;
}

export default function NamespacesPage() {
  const { tenant } = useAuthStore();
  const qc = useQueryClient();
  const tenantId = tenant!.id;

  const { data: namespaces = [], isLoading } = useQuery({
    queryKey: ['namespaces', tenantId],
    queryFn: () => api.listNamespaces(tenantId),
  });

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Namespace | null>(null);
  const [form, setForm] = useState({ name: '', slug: '', description: '' });
  const [formError, setFormError] = useState('');

  const createMutation = useMutation({
    mutationFn: () => api.createNamespace(tenantId, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['namespaces', tenantId] }); setShowForm(false); setForm({ name: '', slug: '', description: '' }); },
    onError: (e: Error) => setFormError(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: () => api.updateNamespace(tenantId, editing!.id, { description: form.description, name: form.name }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['namespaces', tenantId] }); setEditing(null); },
    onError: (e: Error) => setFormError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteNamespace(tenantId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['namespaces', tenantId] }),
  });

  function openEdit(ns: Namespace) {
    setEditing(ns);
    setForm({ name: ns.name, slug: ns.slug, description: ns.description });
    setFormError('');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (form.description.length < MIN_DESC_LEN) {
      setFormError(`Description must be at least ${MIN_DESC_LEN} characters`);
      return;
    }
    editing ? updateMutation.mutate() : createMutation.mutate();
  }

  const slugFromName = (n: string) =>
    n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Namespaces</h1>
          <p className="text-muted-foreground text-sm mt-1">Each namespace is automatically exposed as an MCP tool.</p>
        </div>
        <Button onClick={() => { setShowForm(true); setEditing(null); setForm({ name: '', slug: '', description: '' }); setFormError(''); }}>
          <Plus size={16} className="mr-2" /> New Namespace
        </Button>
      </div>

      {(showForm || editing) && (
        <Card className="mb-6 border-primary/30">
          <CardHeader>
            <CardTitle className="text-lg">{editing ? 'Edit Namespace' : 'Create Namespace'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    value={form.name}
                    onChange={(e) => {
                      const n = e.target.value;
                      setForm((f) => ({ ...f, name: n, slug: editing ? f.slug : slugFromName(n) }));
                    }}
                    placeholder="Maintenance Manuals"
                    required
                    disabled={!!editing}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Slug</label>
                  <Input value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} placeholder="maintenance-manuals" required disabled={!!editing} />
                  {form.slug && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Zap size={11} /> MCP tool: <code className="bg-muted px-1 rounded">query__{form.slug}</code>
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium flex justify-between">
                  <span>Description</span>
                  <span className={`text-xs ${form.description.length < MIN_DESC_LEN ? 'text-yellow-600' : 'text-muted-foreground'}`}>
                    {form.description.length}/{MAX_DESC_LEN}
                  </span>
                </label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Use this to answer questions about equipment maintenance schedules, repair procedures, and technical specifications for…"
                  rows={4}
                  maxLength={MAX_DESC_LEN}
                  required
                />
                <DescriptionQualityHint desc={form.description} />
              </div>

              {formError && <p className="text-sm text-destructive">{formError}</p>}

              <div className="flex gap-2">
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {editing ? 'Save Changes' : 'Create Namespace'}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null); }}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading namespaces…</div>
      ) : namespaces.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Database size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No namespaces yet</p>
          <p className="text-sm">Create your first namespace to start uploading documents.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {namespaces.map((ns) => (
            <Card key={ns.id} className="hover:border-primary/40 transition-colors">
              <CardContent className="py-4 px-5 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{ns.name}</span>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                      query__{ns.slug}
                    </code>
                    <Badge variant={ns.active ? 'success' : 'secondary'}>
                      {ns.active ? 'active' : 'inactive'}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{ns.description}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(ns)}>
                    <Pencil size={15} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => { if (confirm(`Delete namespace "${ns.name}"?`)) deleteMutation.mutate(ns.id); }}
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Database({ size, className }: { size: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <ellipse cx="12" cy="5" rx="9" ry="3"/>
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
    </svg>
  );
}
