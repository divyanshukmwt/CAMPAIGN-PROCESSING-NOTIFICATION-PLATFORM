import React from 'react';
import {
  Activity,
  Cpu,
  Database,
  Layers,
  Plus,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { ApiTelemetryMeta, SystemHealth } from '../types/campaign';

interface SystemHealthHeaderProps {
  health: SystemHealth | null;
  telemetry: ApiTelemetryMeta;
  sseConnected: boolean;
  tenantId: string;
  onTenantChange: (tenant: string) => void;
  onRefresh: () => void;
  onOpenCreateModal: () => void;
}

export const SystemHealthHeader: React.FC<SystemHealthHeaderProps> = ({
  health,
  telemetry,
  sseConnected,
  tenantId,
  onTenantChange,
  onRefresh,
  onOpenCreateModal,
}) => {
  const dbOk = health?.database.connected ?? false;
  const redisOk = health?.redis.connected ?? false;
  const workerCount = health?.workers.activeWorkerCount ?? 0;
  const cacheHitPct = health
    ? Math.round((health.cache.hitRate || 0) * 100)
    : 0;

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/90 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Brand Title */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600/20 border border-indigo-500/40 text-indigo-400">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white">
                  Campaign Notification Platform
                </h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-500/30">
                  <Radio className="h-3 w-3 animate-pulse" />
                  {sseConnected ? 'SSE Live' : 'Polling'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                BullMQ Queue Orchestration • 3-Layer Idempotency • Atomic Concurrency
              </p>
            </div>
          </div>

          {/* Right Controls: Tenant Switcher, Refresh & New Campaign */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs">
              <ShieldCheck className="h-3.5 w-3.5 text-indigo-400" />
              <span className="text-slate-400">Tenant:</span>
              <select
                value={tenantId}
                onChange={(e) => onTenantChange(e.target.value)}
                className="bg-transparent font-medium text-slate-100 focus:outline-none cursor-pointer"
                aria-label="Select Tenant"
              >
                <option value="default-tenant" className="bg-slate-900">
                  default-tenant
                </option>
                <option value="tenant-alpha" className="bg-slate-900">
                  tenant-alpha
                </option>
                <option value="tenant-beta" className="bg-slate-900">
                  tenant-beta
                </option>
              </select>
            </div>

            <button
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition"
              title="Refresh persisted state"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Sync
            </button>

            <button
              onClick={onOpenCreateModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 transition"
            >
              <Plus className="h-4 w-4" />
              New Campaign
            </button>
          </div>
        </div>

        {/* Live Telemetry Strip */}
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-800/80 pt-2.5 sm:grid-cols-3 lg:grid-cols-6 text-xs">
          {/* MongoDB Status */}
          <div className="flex items-center gap-2 rounded-lg bg-slate-900/70 px-2.5 py-1.5 border border-slate-800/80">
            <Database
              className={`h-3.5 w-3.5 ${
                dbOk ? 'text-emerald-400' : 'text-amber-400'
              }`}
            />
            <div className="truncate">
              <span className="text-slate-400">Mongo: </span>
              <span className="font-medium text-slate-200">
                {dbOk ? 'Connected' : 'Connecting'}
              </span>
            </div>
          </div>

          {/* Redis Status */}
          <div className="flex items-center gap-2 rounded-lg bg-slate-900/70 px-2.5 py-1.5 border border-slate-800/80">
            <Server
              className={`h-3.5 w-3.5 ${
                redisOk ? 'text-emerald-400' : 'text-sky-400'
              }`}
            />
            <div className="truncate">
              <span className="text-slate-400">Redis: </span>
              <span className="font-medium text-slate-200">
                {redisOk
                  ? `Ready (${health?.redis.latencyMs ?? 1}ms)`
                  : 'Embedded Mode'}
              </span>
            </div>
          </div>

          {/* Worker Heartbeats */}
          <div className="flex items-center gap-2 rounded-lg bg-slate-900/70 px-2.5 py-1.5 border border-slate-800/80">
            <Cpu className="h-3.5 w-3.5 text-indigo-400" />
            <div className="truncate">
              <span className="text-slate-400">Workers: </span>
              <span className="font-medium text-slate-200">
                {workerCount > 0 ? `${workerCount} Active` : 'Auto-Runner'}
              </span>
            </div>
          </div>

          {/* Cache Telemetry */}
          <div className="flex items-center gap-2 rounded-lg bg-slate-900/70 px-2.5 py-1.5 border border-slate-800/80">
            <Layers className="h-3.5 w-3.5 text-purple-400" />
            <div className="flex items-center gap-1.5 truncate">
              <span className="text-slate-400">Cache:</span>
              <span className="font-medium text-slate-200">{cacheHitPct}%</span>
              {telemetry.lastCacheStatus && (
                <span
                  className={`rounded px-1 py-0.2 text-[10px] font-bold ${
                    telemetry.lastCacheStatus === 'HIT'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-amber-500/20 text-amber-300'
                  }`}
                >
                  {telemetry.lastCacheStatus}
                </span>
              )}
            </div>
          </div>

          {/* Rate Limiter Quota */}
          <div className="flex items-center gap-2 rounded-lg bg-slate-900/70 px-2.5 py-1.5 border border-slate-800/80">
            <Activity className="h-3.5 w-3.5 text-cyan-400" />
            <div className="truncate">
              <span className="text-slate-400">Rate Quota: </span>
              <span className="font-medium text-slate-200">
                {telemetry.rateLimitRemaining !== null
                  ? `${telemetry.rateLimitRemaining}/${telemetry.rateLimitLimit ?? 180}`
                  : 'OK'}
              </span>
            </div>
          </div>

          {/* Provider Deduplication Telemetry */}
          <div className="flex items-center gap-2 rounded-lg bg-slate-900/70 px-2.5 py-1.5 border border-slate-800/80">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            <div className="truncate">
              <span className="text-slate-400">Sent / Dedup: </span>
              <span className="font-medium text-slate-200">
                {health?.provider.totalActualDispatches ?? 0} /{' '}
                {health?.provider.totalDeduplicatedHits ?? 0}
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
