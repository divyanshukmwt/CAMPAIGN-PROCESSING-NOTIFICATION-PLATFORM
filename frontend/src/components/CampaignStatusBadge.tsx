import React from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  FileEdit,
  Loader2,
  Mail,
  MessageSquare,
  PauseCircle,
  Smartphone,
  XCircle,
} from 'lucide-react';
import {
  CampaignChannel,
  CampaignStats,
  CampaignStatus,
} from '../types/campaign';

export const CampaignStatusBadge: React.FC<{ status: CampaignStatus }> = ({
  status,
}) => {
  const styles: Record<
    CampaignStatus,
    { label: string; className: string; icon: React.ReactNode }
  > = {
    draft: {
      label: 'Draft',
      className: 'bg-slate-800 text-slate-300 border-slate-700',
      icon: <FileEdit className="h-3.5 w-3.5" />,
    },
    scheduled: {
      label: 'Scheduled',
      className: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
      icon: <Clock className="h-3.5 w-3.5" />,
    },
    processing: {
      label: 'Processing',
      className: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    },
    paused: {
      label: 'Paused',
      className: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
      icon: <PauseCircle className="h-3.5 w-3.5" />,
    },
    completed: {
      label: 'Completed',
      className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    },
    partially_failed: {
      label: 'Partially Failed',
      className: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
    },
    failed: {
      label: 'Failed',
      className: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
      icon: <XCircle className="h-3.5 w-3.5" />,
    },
    cancelled: {
      label: 'Cancelled',
      className: 'bg-slate-800/80 text-slate-400 border-slate-700',
      icon: <Ban className="h-3.5 w-3.5" />,
    },
  };

  const config = styles[status] || styles.draft;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.icon}
      {config.label}
    </span>
  );
};

export const ChannelBadge: React.FC<{ channel: CampaignChannel }> = ({
  channel,
}) => {
  const icons: Record<CampaignChannel, React.ReactNode> = {
    email: <Mail className="h-3 w-3 text-indigo-400" />,
    sms: <MessageSquare className="h-3 w-3 text-emerald-400" />,
    push: <Smartphone className="h-3 w-3 text-amber-400" />,
  };

  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-slate-900 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-slate-300">
      {icons[channel]}
      {channel}
    </span>
  );
};

export const CampaignProgressBar: React.FC<{
  stats: CampaignStats;
  compact?: boolean;
}> = ({ stats, compact = false }) => {
  const total = Math.max(1, stats.total || 0);
  const succeededPct = Math.min(100, (stats.succeeded / total) * 100);
  const processingPct = Math.min(100, (stats.processing / total) * 100);
  const failedPct = Math.min(100, (stats.failed / total) * 100);
  const skippedPct = Math.min(100, (stats.skipped / total) * 100);

  const completedCount = stats.succeeded + stats.failed + stats.skipped;
  const progressPercent =
    stats.total > 0 ? Math.round((completedCount / stats.total) * 100) : 0;

  return (
    <div className="w-full space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-slate-300">
          {completedCount.toLocaleString()} / {stats.total.toLocaleString()}{' '}
          <span className="text-slate-500">processed</span>
        </span>
        <span className="font-semibold text-indigo-400">{progressPercent}%</span>
      </div>

      {/* Stacked Progress Bar */}
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
        {succeededPct > 0 && (
          <div
            style={{ width: `${succeededPct}%` }}
            className="bg-emerald-500 transition-all duration-300"
            title={`Succeeded: ${stats.succeeded}`}
          />
        )}
        {processingPct > 0 && (
          <div
            style={{ width: `${processingPct}%` }}
            className="bg-indigo-500 animate-pulse transition-all duration-300"
            title={`Processing: ${stats.processing}`}
          />
        )}
        {failedPct > 0 && (
          <div
            style={{ width: `${failedPct}%` }}
            className="bg-rose-500 transition-all duration-300"
            title={`Failed: ${stats.failed}`}
          />
        )}
        {skippedPct > 0 && (
          <div
            style={{ width: `${skippedPct}%` }}
            className="bg-amber-500/80 transition-all duration-300"
            title={`Skipped: ${stats.skipped}`}
          />
        )}
      </div>

      {/* All 6 Required Recipient Statistics (Module 1) */}
      <div
        className={`grid gap-1.5 text-[11px] ${
          compact ? 'grid-cols-3 sm:grid-cols-6' : 'grid-cols-6'
        }`}
      >
        <div className="rounded bg-slate-900/90 px-1.5 py-1 border border-slate-800/80">
          <span className="text-slate-400">Total: </span>
          <span className="font-semibold text-slate-200">
            {stats.total.toLocaleString()}
          </span>
        </div>
        <div className="rounded bg-slate-900/90 px-1.5 py-1 border border-slate-800/80">
          <span className="text-slate-400">Queued: </span>
          <span className="font-semibold text-sky-300">
            {stats.queued.toLocaleString()}
          </span>
        </div>
        <div className="rounded bg-slate-900/90 px-1.5 py-1 border border-slate-800/80">
          <span className="text-slate-400">Active: </span>
          <span className="font-semibold text-indigo-300">
            {stats.processing.toLocaleString()}
          </span>
        </div>
        <div className="rounded bg-slate-900/90 px-1.5 py-1 border border-slate-800/80">
          <span className="text-slate-400">Sent: </span>
          <span className="font-semibold text-emerald-400">
            {stats.succeeded.toLocaleString()}
          </span>
        </div>
        <div className="rounded bg-slate-900/90 px-1.5 py-1 border border-slate-800/80">
          <span className="text-slate-400">Failed: </span>
          <span className="font-semibold text-rose-400">
            {stats.failed.toLocaleString()}
          </span>
        </div>
        <div className="rounded bg-slate-900/90 px-1.5 py-1 border border-slate-800/80">
          <span className="text-slate-400">Skipped: </span>
          <span className="font-semibold text-amber-300">
            {stats.skipped.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
};
