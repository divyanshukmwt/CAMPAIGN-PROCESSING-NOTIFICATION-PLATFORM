import React from 'react';
import {
  AlertOctagon,
  CheckCircle2,
  Clock,
  Layers,
  Send,
  Users,
} from 'lucide-react';
import { DashboardSummary } from '../types/campaign';

export const DashboardSummaryCards: React.FC<{
  summary: DashboardSummary | null;
}> = ({ summary }) => {
  const totals = summary?.deliveryTotals || {
    total: 0,
    queued: 0,
    processing: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  const activeCampaigns =
    (summary?.statusCounts.processing || 0) +
    (summary?.statusCounts.scheduled || 0) +
    (summary?.statusCounts.paused || 0);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* Total Campaigns */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
            Total Campaigns
          </span>
          <div className="rounded-lg bg-indigo-500/10 p-2 text-indigo-400">
            <Layers className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-white">
            {(summary?.totalCampaigns ?? 0).toLocaleString()}
          </span>
          <span className="text-xs text-indigo-400">
            {activeCampaigns} active/scheduled
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-400">
          <span>Completed: {summary?.statusCounts.completed ?? 0}</span>
          <span>•</span>
          <span>Partial: {summary?.statusCounts.partially_failed ?? 0}</span>
          <span>•</span>
          <span>Paused: {summary?.statusCounts.paused ?? 0}</span>
        </div>
      </div>

      {/* Total & Queued Recipients */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
            Recipient Workload
          </span>
          <div className="rounded-lg bg-sky-500/10 p-2 text-sky-400">
            <Users className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-white">
            {totals.total.toLocaleString()}
          </span>
          <span className="text-xs text-sky-400">
            {totals.queued.toLocaleString()} queued
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
          <Clock className="h-3 w-3 text-indigo-400" />
          <span>In-flight processing: {totals.processing.toLocaleString()}</span>
        </div>
      </div>

      {/* Succeeded & Delivery Rate */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
            Delivered Successfully
          </span>
          <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-emerald-400">
            {totals.succeeded.toLocaleString()}
          </span>
          <span className="text-xs font-semibold text-emerald-300">
            {summary?.overallSuccessRate ?? 100}% success rate
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
          <Send className="h-3 w-3 text-emerald-400" />
          <span>Deduplicated via stable deliveryId</span>
        </div>
      </div>

      {/* Failed & Skipped */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
            Failed & Skipped
          </span>
          <div className="rounded-lg bg-rose-500/10 p-2 text-rose-400">
            <AlertOctagon className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-3">
          <div>
            <span className="text-2xl font-bold text-rose-400">
              {totals.failed.toLocaleString()}
            </span>
            <span className="ml-1 text-xs text-rose-300">failed</span>
          </div>
          <div>
            <span className="text-lg font-semibold text-amber-300">
              {totals.skipped.toLocaleString()}
            </span>
            <span className="ml-1 text-xs text-amber-300/80">skipped</span>
          </div>
        </div>
        <div className="mt-2 text-[11px] text-slate-400">
          Failed deliveries available for manual retry
        </div>
      </div>
    </div>
  );
};
