import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Edit3,
  History,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Square,
  X,
  XCircle,
} from 'lucide-react';
import {
  fetchCampaignById,
  fetchCampaignDeliveries,
  retryCampaignDeliveries,
  triggerCampaignAction,
  updateCampaignRequest,
} from '../api/client';
import { Campaign, Delivery, DeliveryStatus } from '../types/campaign';
import {
  CampaignProgressBar,
  CampaignStatusBadge,
  ChannelBadge,
} from './CampaignStatusBadge';

interface CampaignDetailInspectorProps {
  campaignId: string | null;
  onClose: () => void;
  onUpdated: () => void;
}

export const CampaignDetailInspector: React.FC<
  CampaignDetailInspectorProps
> = ({ campaignId, onClose, onUpdated }) => {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusTab, setStatusTab] = useState<string>('all');
  const [failureTypeFilter, setFailureTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);

  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState<Set<string>>(
    new Set()
  );
  const [expandedDeliveryId, setExpandedDeliveryId] = useState<string | null>(
    null
  );
  const [actionBusy, setActionBusy] = useState(false);

  // Edit mode for draft/scheduled/paused campaigns
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [editTemplate, setEditTemplate] = useState('');

  const loadInspectorData = useCallback(
    async (silent = false) => {
      if (!campaignId) return;
      if (!silent) setLoading(true);
      try {
        const [campRes, delRes] = await Promise.all([
          fetchCampaignById(campaignId),
          fetchCampaignDeliveries({
            campaignId,
            page,
            limit: 15,
            status: statusTab,
            failureType: failureTypeFilter,
            search,
          }),
        ]);

        setCampaign(campRes.campaign);
        setDeliveries(delRes.items);
        setTotalPages(delRes.pagination.totalPages);
        setTotalItems(delRes.pagination.totalItems);
        if (!isEditing) {
          setEditName(campRes.campaign.name);
          setEditSubject(campRes.campaign.subject || '');
          setEditTemplate(campRes.campaign.messageTemplate);
        }
        setError(null);
      } catch (err) {
        setError((err as Error).message || 'Failed to load campaign details');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [campaignId, page, statusTab, failureTypeFilter, search, isEditing]
  );

  useEffect(() => {
    if (!campaignId) return;
    setSelectedDeliveryIds(new Set());
    void loadInspectorData(false);

    const interval = setInterval(() => {
      void loadInspectorData(true);
    }, 2000);

    return () => clearInterval(interval);
  }, [campaignId, loadInspectorData]);

  if (!campaignId) return null;

  const handleLifecycleAction = async (
    action: 'start' | 'pause' | 'resume' | 'cancel'
  ) => {
    setActionBusy(true);
    try {
      await triggerCampaignAction(campaignId, action);
      await loadInspectorData(true);
      onUpdated();
    } catch (err) {
      setError((err as Error).message || `Failed to ${action} campaign`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleRetryDeliveries = async (onlySelected: boolean) => {
    setActionBusy(true);
    try {
      const ids = onlySelected ? Array.from(selectedDeliveryIds) : undefined;
      await retryCampaignDeliveries(campaignId, ids);
      setSelectedDeliveryIds(new Set());
      await loadInspectorData(false);
      onUpdated();
    } catch (err) {
      setError((err as Error).message || 'Failed to retry deliveries');
    } finally {
      setActionBusy(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionBusy(true);
    try {
      await updateCampaignRequest(campaignId, {
        name: editName,
        subject: editSubject,
        messageTemplate: editTemplate,
      });
      setIsEditing(false);
      await loadInspectorData(false);
      onUpdated();
    } catch (err) {
      setError((err as Error).message || 'Failed to update campaign');
    } finally {
      setActionBusy(false);
    }
  };

  const toggleSelectDelivery = (deliveryId: string) => {
    setSelectedDeliveryIds((prev) => {
      const next = new Set(prev);
      if (next.has(deliveryId)) {
        next.delete(deliveryId);
      } else {
        next.add(deliveryId);
      }
      return next;
    });
  };

  const renderDeliveryStatusBadge = (status: DeliveryStatus) => {
    const map: Record<DeliveryStatus, { label: string; cls: string }> = {
      queued: {
        label: 'Queued',
        cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
      },
      processing: {
        label: 'Processing',
        cls: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
      },
      succeeded: {
        label: 'Succeeded',
        cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      },
      failed: {
        label: 'Failed',
        cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
      },
      skipped: {
        label: 'Skipped',
        cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
      },
    };
    const item = map[status] || map.queued;
    return (
      <span
        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${item.cls}`}
      >
        {item.label}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="relative my-6 w-full max-w-6xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Top Modal Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/70 px-6 py-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-lg font-bold text-white">
              {campaign?.name || 'Campaign Inspector'}
            </h2>
            {campaign && <CampaignStatusBadge status={campaign.status} />}
            {campaign && <ChannelBadge channel={campaign.channel} />}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadInspectorData(false)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="max-h-[84vh] overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-3.5 text-xs text-rose-200">
              {error}
            </div>
          )}

          {campaign && (
            <>
              {/* Campaign Progress & Lifecycle Controls Box */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1 text-xs text-slate-400">
                    <div>
                      Campaign ID:{' '}
                      <code className="text-slate-200">{campaign._id}</code>
                      {campaign.idempotencyKey && (
                        <span className="ml-3">
                          Idempotency-Key:{' '}
                          <code className="text-indigo-300">
                            {campaign.idempotencyKey}
                          </code>
                        </span>
                      )}
                    </div>
                    <div>
                      Batch Size: <strong>{campaign.config.batchSize}</strong> •
                      Max Attempts: <strong>{campaign.config.maxAttempts}</strong>{' '}
                      • Backoff Base:{' '}
                      <strong>{campaign.config.backoffDelayMs}ms</strong>
                    </div>
                  </div>

                  {/* Lifecycle Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2">
                    {['draft', 'scheduled', 'paused'].includes(
                      campaign.status
                    ) && (
                      <button
                        onClick={() => setIsEditing(!isEditing)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        {isEditing ? 'Close Edit' : 'Edit Campaign'}
                      </button>
                    )}

                    {['draft', 'scheduled'].includes(campaign.status) && (
                      <button
                        disabled={actionBusy}
                        onClick={() => void handleLifecycleAction('start')}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        <Play className="h-3.5 w-3.5" />
                        Start Campaign
                      </button>
                    )}

                    {['processing', 'scheduled'].includes(campaign.status) && (
                      <button
                        disabled={actionBusy}
                        onClick={() => void handleLifecycleAction('pause')}
                        className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
                      >
                        <Pause className="h-3.5 w-3.5" />
                        Pause
                      </button>
                    )}

                    {campaign.status === 'paused' && (
                      <button
                        disabled={actionBusy}
                        onClick={() => void handleLifecycleAction('resume')}
                        className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                      >
                        <Play className="h-3.5 w-3.5" />
                        Resume
                      </button>
                    )}

                    {['draft', 'scheduled', 'processing', 'paused'].includes(
                      campaign.status
                    ) && (
                      <button
                        disabled={actionBusy}
                        onClick={() => void handleLifecycleAction('cancel')}
                        className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
                      >
                        <Square className="h-3.5 w-3.5" />
                        Cancel Campaign
                      </button>
                    )}

                    {campaign.stats.failed > 0 && (
                      <button
                        disabled={actionBusy}
                        onClick={() => void handleRetryDeliveries(false)}
                        className="inline-flex items-center gap-1 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Retry All Failed ({campaign.stats.failed})
                      </button>
                    )}

                    {selectedDeliveryIds.size > 0 && (
                      <button
                        disabled={actionBusy}
                        onClick={() => void handleRetryDeliveries(true)}
                        className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Retry Selected ({selectedDeliveryIds.size})
                      </button>
                    )}
                  </div>
                </div>

                {/* Inline Edit Form */}
                {isEditing && (
                  <form
                    onSubmit={(e) => void handleSaveEdit(e)}
                    className="rounded-lg border border-indigo-500/30 bg-slate-900 p-3.5 space-y-3 text-xs"
                  >
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-slate-400 mb-1">
                          Campaign Name
                        </label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 mb-1">
                          Subject
                        </label>
                        <input
                          type="text"
                          value={editSubject}
                          onChange={(e) => setEditSubject(e.target.value)}
                          className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">
                        Message Template
                      </label>
                      <textarea
                        rows={2}
                        value={editTemplate}
                        onChange={(e) => setEditTemplate(e.target.value)}
                        className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={actionBusy}
                        className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-500"
                      >
                        <Save className="h-3.5 w-3.5" />
                        Save Changes
                      </button>
                    </div>
                  </form>
                )}

                <CampaignProgressBar stats={campaign.stats} />
              </div>

              {/* Filter Tabs & Search for Deliveries / Failed Recipient Inspection */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {[
                    { id: 'all', label: `All (${campaign.stats.total})` },
                    {
                      id: 'failed',
                      label: `Failed (${campaign.stats.failed})`,
                    },
                    {
                      id: 'skipped',
                      label: `Skipped (${campaign.stats.skipped})`,
                    },
                    {
                      id: 'succeeded',
                      label: `Succeeded (${campaign.stats.succeeded})`,
                    },
                    {
                      id: 'queued',
                      label: `Queued (${campaign.stats.queued})`,
                    },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => {
                        setStatusTab(tab.id);
                        setPage(1);
                      }}
                      className={`rounded-lg px-3 py-1.5 font-medium transition ${
                        statusTab === tab.id
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <select
                    value={failureTypeFilter}
                    onChange={(e) => {
                      setFailureTypeFilter(e.target.value);
                      setPage(1);
                    }}
                    className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-slate-200"
                    aria-label="Filter by Failure Type"
                  >
                    <option value="all">All Failure Types</option>
                    <option value="permanent">Permanent Bounce</option>
                    <option value="transient">Transient Exhausted</option>
                    <option value="validation">Validation Error</option>
                    <option value="duplicate">Duplicate Upload</option>
                    <option value="cancelled">Cancelled</option>
                  </select>

                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                      }}
                      placeholder="Search recipient, deliveryId, error..."
                      className="rounded-lg border border-slate-800 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Deliveries Table */}
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
                {loading && deliveries.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-xs text-slate-400">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin text-indigo-400" />
                    Loading recipient delivery records...
                  </div>
                ) : deliveries.length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-400">
                    No delivery records match the current filter.
                  </div>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 bg-slate-900/90 text-[11px] uppercase text-slate-400">
                      <tr>
                        <th className="px-3 py-2.5 w-8">Sel</th>
                        <th className="px-3 py-2.5">Recipient</th>
                        <th className="px-3 py-2.5">Delivery ID</th>
                        <th className="px-3 py-2.5">Status</th>
                        <th className="px-3 py-2.5">Failure Type</th>
                        <th className="px-3 py-2.5">Attempts</th>
                        <th className="px-3 py-2.5">Error Reason / Receipt</th>
                        <th className="px-3 py-2.5 text-right">History</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {deliveries.map((del) => {
                        const isExpanded = expandedDeliveryId === del.deliveryId;
                        const canSelect = del.status === 'failed';
                        return (
                          <React.Fragment key={del._id}>
                            <tr className="hover:bg-slate-900/60">
                              <td className="px-3 py-2.5">
                                {canSelect && (
                                  <input
                                    type="checkbox"
                                    checked={selectedDeliveryIds.has(
                                      del.deliveryId
                                    )}
                                    onChange={() =>
                                      toggleSelectDelivery(del.deliveryId)
                                    }
                                    className="rounded border-slate-700 bg-slate-900 text-indigo-600 cursor-pointer"
                                  />
                                )}
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="font-medium text-slate-200">
                                  {del.recipient}
                                </div>
                                {del.recipientName && (
                                  <div className="text-[11px] text-slate-500">
                                    {del.recipientName}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2.5 font-mono text-[11px] text-slate-400">
                                {del.deliveryId.slice(0, 18)}...
                              </td>
                              <td className="px-3 py-2.5">
                                {renderDeliveryStatusBadge(del.status)}
                              </td>
                              <td className="px-3 py-2.5">
                                {del.failureType ? (
                                  <span
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                                      del.failureType === 'permanent'
                                        ? 'bg-rose-500/20 text-rose-300'
                                        : del.failureType === 'transient'
                                          ? 'bg-orange-500/20 text-orange-300'
                                          : 'bg-amber-500/20 text-amber-300'
                                    }`}
                                  >
                                    {del.failureType}
                                  </span>
                                ) : (
                                  <span className="text-slate-600">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-slate-300">
                                {del.attemptsMade} / {del.maxAttempts}
                              </td>
                              <td className="px-3 py-2.5 max-w-xs truncate">
                                {del.lastError ? (
                                  <span
                                    className="text-rose-300"
                                    title={del.lastError}
                                  >
                                    {del.lastError}
                                  </span>
                                ) : del.providerMessageId ? (
                                  <code className="text-[11px] text-emerald-400">
                                    {del.providerMessageId}
                                  </code>
                                ) : (
                                  <span className="text-slate-500">
                                    Waiting in queue
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <button
                                  onClick={() =>
                                    setExpandedDeliveryId(
                                      isExpanded ? null : del.deliveryId
                                    )
                                  }
                                  className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700"
                                >
                                  <History className="h-3 w-3" />
                                  {del.attemptHistory?.length || 0}
                                  {isExpanded ? (
                                    <ChevronUp className="h-3 w-3" />
                                  ) : (
                                    <ChevronDown className="h-3 w-3" />
                                  )}
                                </button>
                              </td>
                            </tr>

                            {/* Expandable Attempt History Row */}
                            {isExpanded && (
                              <tr className="bg-slate-900/95">
                                <td colSpan={8} className="px-6 py-3">
                                  <div className="space-y-1.5 text-[11px]">
                                    <div className="font-semibold text-slate-300">
                                      Full Delivery ID:{' '}
                                      <code className="text-indigo-300">
                                        {del.deliveryId}
                                      </code>
                                    </div>
                                    {(!del.attemptHistory ||
                                      del.attemptHistory.length === 0) && (
                                      <p className="text-slate-400">
                                        No provider attempts executed yet (
                                        {del.lastError || del.status}).
                                      </p>
                                    )}
                                    {del.attemptHistory?.map((att, idx) => (
                                      <div
                                        key={idx}
                                        className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950 px-3 py-1.5"
                                      >
                                        <div className="flex items-center gap-2">
                                          {att.status === 'succeeded' ? (
                                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                                          ) : att.status ===
                                            'failed_permanent' ? (
                                            <XCircle className="h-3.5 w-3.5 text-rose-400" />
                                          ) : (
                                            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                                          )}
                                          <span className="font-medium text-slate-200">
                                            Attempt #{att.attempt} ({att.status}
                                            )
                                          </span>
                                          {att.deduplicated && (
                                            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">
                                              Provider Idempotent Hit
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-slate-400">
                                          {att.error ? (
                                            <span className="text-rose-300">
                                              {att.errorCode}: {att.error}
                                            </span>
                                          ) : (
                                            <span className="text-emerald-300">
                                              Receipt: {att.providerMessageId} (
                                              {att.durationMs ?? 0}ms)
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-1 text-slate-500">
                                          <Clock className="h-3 w-3" />
                                          {new Date(
                                            att.timestamp
                                          ).toLocaleTimeString()}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Deliveries Pagination */}
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>
                  Page <strong className="text-slate-200">{page}</strong> of{' '}
                  <strong className="text-slate-200">{totalPages}</strong> (
                  {totalItems.toLocaleString()} matching deliveries)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Prev
                  </button>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => setPage(page + 1)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                  >
                    Next
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
