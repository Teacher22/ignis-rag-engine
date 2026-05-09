import { useAuthStore } from '../stores/auth.store';

const BASE_URL = '/api/v1';

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (res.status === 401) {
    useAuthStore.getState().clearAuth();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  // Auth
  login: (apiKey: string) =>
    request<{ token: string; tenant: { id: string; name: string; plan: string } }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ apiKey }) }
    ),

  // Namespaces
  listNamespaces: (tenantId: string) =>
    request<import('@ignis/shared').Namespace[]>(`/tenants/${tenantId}/namespaces`),

  createNamespace: (
    tenantId: string,
    body: import('@ignis/shared').CreateNamespaceBody
  ) =>
    request<import('@ignis/shared').Namespace>(`/tenants/${tenantId}/namespaces`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateNamespace: (
    tenantId: string,
    namespaceId: string,
    body: import('@ignis/shared').UpdateNamespaceBody
  ) =>
    request<import('@ignis/shared').Namespace>(
      `/tenants/${tenantId}/namespaces/${namespaceId}`,
      { method: 'PATCH', body: JSON.stringify(body) }
    ),

  deleteNamespace: (tenantId: string, namespaceId: string) =>
    request<void>(`/tenants/${tenantId}/namespaces/${namespaceId}`, {
      method: 'DELETE',
    }),

  // Documents
  listDocuments: (tenantId: string, namespaceId: string) =>
    request<import('@ignis/shared').Document[]>(
      `/tenants/${tenantId}/namespaces/${namespaceId}/documents`
    ),

  uploadDocument: (tenantId: string, namespaceId: string, file: File) => {
    const token = useAuthStore.getState().token;
    const form = new FormData();
    form.append('file', file);
    return fetch(
      `${BASE_URL}/tenants/${tenantId}/namespaces/${namespaceId}/documents`,
      {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      }
    ).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<import('@ignis/shared').UploadDocumentResponse>;
    });
  },

  getJobStatus: (tenantId: string, jobId: string) =>
    request<import('@ignis/shared').JobStatusResponse>(
      `/tenants/${tenantId}/jobs/${jobId}`
    ),
};
