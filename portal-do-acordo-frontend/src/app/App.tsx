import { lazy, Suspense } from 'react';

const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage'));

export default function App() {
  return (
    <Suspense fallback={<div role="status" aria-live="polite" style={{ padding: 24, fontFamily: 'Inter, system-ui, sans-serif' }}>Carregando painel...</div>}>
      <DashboardPage />
    </Suspense>
  );
}
