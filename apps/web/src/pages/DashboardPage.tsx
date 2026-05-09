import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';
import { api } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Database, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import type { Namespace, Document } from '@ignis/shared';

export default function DashboardPage() {
  const { tenant } = useAuthStore();
  const tenantId = tenant!.id;

  const { data: namespaces = [] } = useQuery({
    queryKey: ['namespaces', tenantId],
    queryFn: () => api.listNamespaces(tenantId),
  });

  // Aggregate documents across all namespaces
  const nsIds = (namespaces as Namespace[]).map((n) => n.id);
  const docQueries = useQuery({
    queryKey: ['all-documents', tenantId, nsIds.join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        nsIds.map((id) => api.listDocuments(tenantId, id))
      );
      return results.flat() as Document[];
    },
    enabled: nsIds.length > 0,
  });

  const allDocs = docQueries.data ?? [];
  const indexed = allDocs.filter((d) => d.status === 'indexed').length;
  const failed = allDocs.filter((d) => d.status === 'failed').length;
  const processing = allDocs.filter((d) => d.status === 'processing' || d.status === 'pending').length;
  const totalChunks = allDocs.reduce((sum, d) => sum + (d.chunkCount ?? 0), 0);

  // Chart: chunks per namespace
  const chunksByNS = (namespaces as Namespace[]).map((ns) => {
    const nsDocs = allDocs.filter((d) => d.namespaceId === ns.id);
    const chunks = nsDocs.reduce((s, d) => s + (d.chunkCount ?? 0), 0);
    return { name: ns.slug, chunks, docs: nsDocs.length };
  }).filter((d) => d.docs > 0);

  const statCards = [
    { label: 'Namespaces', value: namespaces.length, icon: <Database size={18} />, color: 'text-blue-600' },
    { label: 'Documents', value: allDocs.length, icon: <FileText size={18} />, color: 'text-indigo-600' },
    { label: 'Indexed', value: indexed, icon: <CheckCircle2 size={18} />, color: 'text-green-600' },
    { label: 'Failed', value: failed, icon: <AlertCircle size={18} />, color: 'text-red-500' },
    { label: 'In Progress', value: processing, icon: null, color: 'text-yellow-600' },
    { label: 'Total Chunks', value: totalChunks.toLocaleString(), icon: null, color: 'text-purple-600' },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Observability</h1>
      <p className="text-sm text-muted-foreground mb-6">Ingestion status and namespace health overview.</p>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {statCards.map(({ label, value, icon, color }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-3">
              {icon && <span className={color}>{icon}</span>}
              <div>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chunks by namespace chart */}
      {chunksByNS.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Chunks per Namespace</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chunksByNS} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="chunks" radius={[4, 4, 0, 0]}>
                  {chunksByNS.map((_, i) => (
                    <Cell key={i} fill={`hsl(${220 + i * 30}, 70%, 55%)`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Namespace table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Namespace Health</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground text-xs border-b">
                <th className="pb-2 font-medium">Namespace</th>
                <th className="pb-2 font-medium">MCP Tool</th>
                <th className="pb-2 font-medium">Docs</th>
                <th className="pb-2 font-medium">Chunks</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {(namespaces as Namespace[]).map((ns) => {
                const nsDocs = allDocs.filter((d) => d.namespaceId === ns.id);
                const nsChunks = nsDocs.reduce((s, d) => s + (d.chunkCount ?? 0), 0);
                const hasFailed = nsDocs.some((d) => d.status === 'failed');
                return (
                  <tr key={ns.id} className="border-b last:border-0">
                    <td className="py-2.5 font-medium">{ns.name}</td>
                    <td className="py-2.5"><code className="text-xs bg-muted px-1.5 py-0.5 rounded">query__{ns.slug}</code></td>
                    <td className="py-2.5">{nsDocs.length}</td>
                    <td className="py-2.5">{nsChunks.toLocaleString()}</td>
                    <td className="py-2.5">
                      {hasFailed ? (
                        <Badge variant="destructive">errors</Badge>
                      ) : ns.active ? (
                        <Badge variant="success">healthy</Badge>
                      ) : (
                        <Badge variant="secondary">inactive</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {namespaces.length === 0 && (
            <p className="text-center text-muted-foreground py-6 text-sm">No namespaces yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
