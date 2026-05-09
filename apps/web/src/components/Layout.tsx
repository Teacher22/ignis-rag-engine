import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Database, FileText, Search, BarChart2, LogOut, Flame } from 'lucide-react';

const navItems = [
  { to: '/namespaces', label: 'Namespaces', icon: Database },
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/query', label: 'Query Playground', icon: Search },
  { to: '/dashboard', label: 'Observability', icon: BarChart2 },
];

export default function Layout() {
  const { tenant, clearAuth } = useAuthStore();
  const navigate = useNavigate();

  function handleLogout() {
    clearAuth();
    navigate('/login');
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-60 border-r bg-slate-50 flex flex-col">
        <div className="p-4 border-b flex items-center gap-2">
          <Flame className="text-orange-500" size={22} />
          <div>
            <p className="font-semibold text-sm leading-none">Ignis RAG</p>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{tenant?.name}</p>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t">
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground" onClick={handleLogout}>
            <LogOut size={15} />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
