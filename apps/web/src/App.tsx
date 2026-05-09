import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import Layout from '@/components/Layout';
import LoginPage from '@/pages/LoginPage';
import NamespacesPage from '@/pages/NamespacesPage';
import DocumentsPage from '@/pages/DocumentsPage';
import QueryPage from '@/pages/QueryPage';
import DashboardPage from '@/pages/DashboardPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token } = useAuthStore();
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/namespaces" replace />} />
        <Route path="namespaces" element={<NamespacesPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="query" element={<QueryPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
