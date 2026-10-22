import React from 'react';
import {
  AlertCircle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Eye,
  Filter,
  Inbox,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Square,
} from 'lucide-react';
import { Campaign } from '../types/campaign';
import {
  CampaignProgressBar,
  CampaignStatusBadge,
  ChannelBadge,
} from './CampaignStatusBadge';

interface CampaignListViewProps {
  campaigns: Campaign[];
  loading: boolean;
  error: string | null;
  search: string;
  onSearchChange: (val: string) => void;
  statusFilter: string;
  onStatusFilterChange: (val: string) => void;
  channelFilter: string;
  onChannelFilterChange: (val: string) => void;
  page: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onSelectCampaign: (campaign: Campaign) => void;
  onAction: (
    campaignId: string,
    action: 'start' | 'pause' | 'resume' | 'cancel' | 'retry'
  ) => Promise<void>;
  actionLoadingId: string | null;
  onOpenCreateModal: () => void;
  onRetryFetch: () => void;
}

export const CampaignListView: React.FC<CampaignListViewProps> = ({
  campaigns,
  loading,
  error,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  channelFilter,
  onChannelFilterChange,
  page,
  totalPages,
  totalItems,
  onPageChange,
  onSelectCampaign,
  onAction,
  actionLoadingId,
  onOpenCreateModal,
  onRetryFetch,
}) => {
  return (
    <div className="space-y-4">
      {/* Search & Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search campaigns by name, subject, or description..."
            className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-9 pr-4 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-slate-400">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => onStatusFilterChange(e.target.value)}
              className="bg-transparent font-medium text-slate-200 focus:outline-none cursor-pointer"
              aria-label="Filter by Status"
            >
              <option value="all" className="bg-slate-900">
                All Statuses
              </option>
              <option value="processing" className="bg-slate-900">
                Processing
              </option>
              <option value="scheduled" className="bg-slate-900">
                Scheduled
              </option>
              <option value="paused" className="bg-slate-900">
                Paused
              </option>
              <option value="completed" className="bg-slate-900">
                Completed
              </option>
              <option value="partially_failed" className="bg-slate-900">
                Partially Failed
              </option>
              <option value="failed" className="bg-slate-900">
                Failed
              </option>
              <option value="cancelled" className="bg-slate-900">
                Cancelled
              </option>
              <option value="draft" className="bg-slate-900">
                Draft
              </option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5">
            <span className="text-slate-400">Channel:</span>
            <select
              value={channelFilter}
              onChange={(e) => onChannelFilterChange(e.target.value)}
              className="bg-transparent font-medium text-slate-200 focus:outline-none cursor-pointer"
              aria-label="Filter by Channel"
            >
              <option value="all" className="bg-slate-900">
                All Channels
              </option>
              <option value="email" className="bg-slate-900">
                Email
              </option>
              <option value="sms" className="bg-slate-900">
                SMS
              </option>
              <option value="push" className="bg-slate-900">
                Push
              </option>
            </select>
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="flex items-center justify-between rounded-xl border border-rose-500/40 bg-rose-950/30 p-4 text-sm text-rose-200">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="h-5 w-5 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={onRetryFetch}
            className="rounded-lg bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/30 transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-900/40 py-16 text-slate-400">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-400 mb-3" />
          <p className="text-sm font-medium">Loading persisted campaigns...</p>
        </div>
      ) : campaigns.length === 0 ? (
        /* Empty State */
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-900/30 py-16 px-4 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-800/80 text-slate-400">
            <Inbox className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-white">
            No campaigns found
          </h3>
          <p className="mt-1 max-w-md text-xs text-slate-400">
            Create a notification campaign with CSV/JSON recipients or generate
            a 5,000-recipient mock dataset to see real-time batch processing,
            exponential backoff retries, and concurrency controls.
          </p>
          <button
            onClick={onOpenCreateModal}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition"
          >
            <Plus className="h-4 w-4" />
            Create Notification Campaign
          </button>
        </div>
      ) : (
        /* Campaign Cards List */
        <div className="space-y-3">
          {campaigns.map((campaign) => {
            const isBusy = actionLoadingId === campaign._id;
            return (
              <div
                key={campaign._id}
                className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 hover:border-slate-700 transition"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  {/* Left Meta */}
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => onSelectCampaign(campaign)}
                        className="text-base font-semibold text-white hover:text-indigo-400 transition text-left"
                      >
                        {campaign.name}
                      </button>
                      <CampaignStatusBadge status={campaign.status} />
                      <ChannelBadge channel={campaign.channel} />
                      {campaign.idempotencyKey && (
                        <span
                          className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"
                          title={`Idempotency-Key: ${campaign.idempotencyKey}`}
                        >
                          idem:{campaign.idempotencyKey.slice(0, 14)}
                        </span>
                      )}
                    </div>

                    {campaign.subject && (
                      <p className="text-xs text-slate-300">
                        Subject: <span className="text-slate-400">{campaign.subject}</span>
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                      <span>
                        Created: {new Date(campaign.createdAt).toLocaleString()}
                      </span>
                      {campaign.scheduledAt && (
                        <span className="inline-flex items-center gap-1 text-sky-300">
                          <Calendar className="h-3 w-3" />
                          Scheduled:{' '}
                          {new Date(campaign.scheduledAt).toLocaleString()}
                        </span>
                      )}
                      <span>
                        Batch: {campaign.config?.batchSize ?? 250} • Max Attempts:{' '}
                        {campaign.config?.maxAttempts ?? 4}
                      </span>
                    </div>
                  </div>

                  {/* Action Controls */}
                  <div className="flex flex-wrap items-center gap-2">
                    {['draft', 'scheduled'].includes(campaign.status) && (
                      <button
                        disabled={isBusy}
                        onClick={() => void onAction(campaign._id, 'start')}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600/20 border border-emerald-500/40 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-600/30 disabled:opacity-50 transition"
                      >
                        <Play className="h-3.5 w-3.5" />
                        Start Now
                      </button>
                    )}

                    {['processing', 'scheduled'].includes(campaign.status) && (
                      <button
                        disabled={isBusy}
                        onClick={() => void onAction(campaign._id, 'pause')}
                        className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 border border-amber-500/30 px-2.5 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/25 disabled:opacity-50 transition"
                      >
                        <Pause className="h-3.5 w-3.5" />
                        Pause
                      </button>
                    )}

                    {campaign.status === 'paused' && (
                      <button
                        disabled={isBusy}
                        onClick={() => void onAction(campaign._id, 'resume')}
                        className="inline-flex items-center gap-1 rounded-lg bg-indigo-600/20 border border-indigo-500/40 px-2.5 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-600/30 disabled:opacity-50 transition"
                      >
                        <Play className="h-3.5 w-3.5" />
                        Resume
                      </button>
                    )}

                    {['draft', 'scheduled', 'processing', 'paused'].includes(
                      campaign.status
                    ) && (
                      <button
                        disabled={isBusy}
                        onClick={() => void onAction(campaign._id, 'cancel')}
                        className="inline-flex items-center gap-1 rounded-lg bg-rose-500/15 border border-rose-500/30 px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/25 disabled:opacity-50 transition"
                      >
                        <Square className="h-3.5 w-3.5" />
                        Cancel
                      </button>
                    )}

                    {campaign.stats.failed > 0 && (
                      <button
                        disabled={isBusy}
                        onClick={() => void onAction(campaign._id, 'retry')}
                        className="inline-flex items-center gap-1 rounded-lg bg-orange-500/20 border border-orange-500/40 px-2.5 py-1.5 text-xs font-medium text-orange-300 hover:bg-orange-500/30 disabled:opacity-50 transition"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Retry Failed ({campaign.stats.failed})
                      </button>
                    )}

                    <button
                      onClick={() => onSelectCampaign(campaign)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Inspect
                    </button>
                  </div>
                </div>

                {/* Progress & Recipient Statistics */}
                <div className="mt-3.5 pt-3 border-t border-slate-800/80">
                  <CampaignProgressBar stats={campaign.stats} compact />
                </div>
              </div>
            );
          })}

          {/* Pagination Footer */}
          <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2.5 text-xs text-slate-400">
            <span>
              Showing page <strong className="text-slate-200">{page}</strong> of{' '}
              <strong className="text-slate-200">{totalPages}</strong> (
              {totalItems} total campaigns)
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
