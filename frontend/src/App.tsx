import React, { useCallback, useEffect, useState } from 'react';
import {
  API_BASE_URL,
  fetchCampaigns,
  fetchDashboardSummary,
  fetchSystemHealth,
  getTenantId,
  retryCampaignDeliveries,
  setTenantId,
  subscribeApiTelemetry,
  triggerCampaignAction,
} from './api/client';
import { CampaignCreateModal } from './components/CampaignCreateModal';
import { CampaignDetailInspector } from './components/CampaignDetailInspector';
import { CampaignListView } from './components/CampaignListView';
import { DashboardSummaryCards } from './components/DashboardSummaryCards';
import { SystemHealthHeader } from './components/SystemHealthHeader';
import {
  ApiTelemetryMeta,
  Campaign,
  DashboardSummary,
  SystemHealth,
} from './types/campaign';

export function App() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(
    null
  );
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const [telemetry, setTelemetry] = useState<ApiTelemetryMeta>({
    lastCacheStatus: null,
    rateLimitLimit: null,
    rateLimitRemaining: null,
    lastIdempotentReplay: false,
  });
  const [sseConnected, setSseConnected] = useState(false);
  const [tenant, setTenant] = useState(getTenantId());

  const refreshAll = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [healthRes, summaryRes, listRes] = await Promise.all([
          fetchSystemHealth().catch(() => null),
          fetchDashboardSummary(),
          fetchCampaigns({
            page,
            limit: 8,
            status: statusFilter,
            channel: channelFilter,
            search,
          }),
        ]);

        if (healthRes) setHealth(healthRes);
        setSummary(summaryRes);
        setCampaigns(listRes.items);
        setTotalPages(listRes.pagination.totalPages);
        setTotalItems(listRes.pagination.totalItems);
        setError(null);
      } catch (err) {
        setError((err as Error).message || 'Failed to load campaign data');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [page, statusFilter, channelFilter, search]
  );

  useEffect(() => {
    const unsub = subscribeApiTelemetry(setTelemetry);
    void refreshAll(false);
    return unsub;
  }, [tenant, refreshAll]);

  // Real-time Server-Sent Events (SSE) + periodic 2.5s polling while active campaigns exist
  useEffect(() => {
    const es = new EventSource(
      `${API_BASE_URL}/campaigns/events?tenantId=${encodeURIComponent(tenant)}`
    );
    es.onopen = () => setSseConnected(true);
    es.onmessage = () => {
      void refreshAll(true);
    };
    es.onerror = () => setSseConnected(false);

    const pollInterval = setInterval(() => {
      void refreshAll(true);
    }, 2500);

    return () => {
      es.close();
      clearInterval(pollInterval);
    };
  }, [tenant, refreshAll]);

  const handleTenantChange = (nextTenant: string) => {
    setTenantId(nextTenant);
    setTenant(nextTenant);
    setPage(1);
    setSelectedCampaign(null);
  };

  const handleAction = async (
    campaignId: string,
    action: 'start' | 'pause' | 'resume' | 'cancel' | 'retry'
  ) => {
    setActionLoadingId(campaignId);
    try {
      if (action === 'retry') {
        await retryCampaignDeliveries(campaignId);
      } else {
        await triggerCampaignAction(campaignId, action);
      }
      await refreshAll(true);
    } catch (err) {
      setError((err as Error).message || `Failed to ${action} campaign`);
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <SystemHealthHeader
        health={health}
        telemetry={telemetry}
        sseConnected={sseConnected}
        tenantId={tenant}
        onTenantChange={handleTenantChange}
        onRefresh={() => void refreshAll(false)}
        onOpenCreateModal={() => setIsCreateModalOpen(true)}
      />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <DashboardSummaryCards summary={summary} />

        <CampaignListView
          campaigns={campaigns}
          loading={loading}
          error={error}
          search={search}
          onSearchChange={(val) => {
            setSearch(val);
            setPage(1);
          }}
          statusFilter={statusFilter}
          onStatusFilterChange={(val) => {
            setStatusFilter(val);
            setPage(1);
          }}
          channelFilter={channelFilter}
          onChannelFilterChange={(val) => {
            setChannelFilter(val);
            setPage(1);
          }}
          page={page}
          totalPages={totalPages}
          totalItems={totalItems}
          onPageChange={setPage}
          onSelectCampaign={setSelectedCampaign}
          onAction={handleAction}
          actionLoadingId={actionLoadingId}
          onOpenCreateModal={() => setIsCreateModalOpen(true)}
          onRetryFetch={() => void refreshAll(false)}
        />

        <CampaignCreateModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onCreated={(campaign) => {
            void refreshAll(false);
            setSelectedCampaign(campaign);
          }}
        />

        <CampaignDetailInspector
          campaignId={selectedCampaign?._id || null}
          onClose={() => setSelectedCampaign(null)}
          onUpdated={() => void refreshAll(true)}
        />
      </main>
    </div>
  );
}

export default App;
