import React, { useEffect, useState } from 'react';
import {
  API_BASE_URL,
  fetchSystemHealth,
  getTenantId,
  setTenantId,
  subscribeApiTelemetry,
} from './api/client';
import { SystemHealthHeader } from './components/SystemHealthHeader';
import { ApiTelemetryMeta, SystemHealth } from './types/campaign';

export function App() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [telemetry, setTelemetry] = useState<ApiTelemetryMeta>({
    lastCacheStatus: null,
    rateLimitLimit: null,
    rateLimitRemaining: null,
    lastIdempotentReplay: false,
  });
  const [sseConnected, setSseConnected] = useState(false);
  const [tenant, setTenant] = useState(getTenantId());

  const loadHealth = async () => {
    try {
      const h = await fetchSystemHealth();
      setHealth(h);
    } catch {
      // Non-fatal if backend is not yet started
    }
  };

  useEffect(() => {
    const unsub = subscribeApiTelemetry(setTelemetry);
    void loadHealth();
    return unsub;
  }, [tenant]);

  useEffect(() => {
    const es = new EventSource(
      `${API_BASE_URL}/campaigns/events?tenantId=${encodeURIComponent(tenant)}`
    );
    es.onopen = () => setSseConnected(true);
    es.onerror = () => setSseConnected(false);
    return () => es.close();
  }, [tenant]);

  const handleTenantChange = (nextTenant: string) => {
    setTenantId(nextTenant);
    setTenant(nextTenant);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <SystemHealthHeader
        health={health}
        telemetry={telemetry}
        sseConnected={sseConnected}
        tenantId={tenant}
        onTenantChange={handleTenantChange}
        onRefresh={() => void loadHealth()}
        onOpenCreateModal={() => {}}
      />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-300">
          Monitoring Dashboard Shell Initialized — Campaign List, Creation Wizard, and Delivery Inspector will be mounted in Milestones 15–17.
        </div>
      </main>
    </div>
  );
}

export default App;
