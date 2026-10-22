import React, { useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  KeyRound,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  createCampaignRequest,
  generateMockCsvDataset,
  previewRecipientValidation,
} from '../api/client';
import {
  Campaign,
  CampaignChannel,
  CampaignValidationReport,
} from '../types/campaign';

interface CampaignCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (campaign: Campaign, idempotentReplay: boolean) => void;
}

function generateClientIdempotencyKey(): string {
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export const CampaignCreateModal: React.FC<CampaignCreateModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState('Q4 Product Launch Notification');
  const [description, setDescription] = useState(
    'Automated customer release announcement with retry and idempotency guarantees'
  );
  const [channel, setChannel] = useState<CampaignChannel>('email');
  const [subject, setSubject] = useState('Welcome to our Q4 Platform Release!');
  const [messageTemplate, setMessageTemplate] = useState(
    'Hello {{name}}, your account has been upgraded to the new release!'
  );

  const [inputMode, setInputMode] = useState<'csv_text' | 'csv_file' | 'json'>(
    'csv_text'
  );
  const [csvText, setCsvText] = useState<string>(() =>
    [
      'recipient,name,tier',
      'alice@example.com,Alice Johnson,enterprise',
      'bob@example.com,Bob Smith,pro',
      'retry-once-user@example.com,Transient Retry Demo,pro',
      'perm-fail-user@example.com,Hard Bounce Demo,free',
      'alice@example.com,Alice Duplicate Row,free',
      'not-a-valid-email,Malformed Row Demo,free',
    ].join('\n')
  );
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [jsonText, setJsonText] = useState<string>(() =>
    JSON.stringify(
      [
        { recipient: 'alice@example.com', name: 'Alice' },
        { recipient: 'bob@example.com', name: 'Bob' },
        { recipient: 'retry-once@example.com', name: 'Retry Demo' },
      ],
      null,
      2
    )
  );

  const [launchMode, setLaunchMode] = useState<
    'immediate' | 'scheduled' | 'draft'
  >('immediate');
  const [scheduledAt, setScheduledAt] = useState<string>(() => {
    const d = new Date(Date.now() + 30 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  });
  const [rejectInvalid, setRejectInvalid] = useState(false);

  const [batchSize, setBatchSize] = useState(250);
  const [maxAttempts, setMaxAttempts] = useState(4);
  const [backoffDelayMs, setBackoffDelayMs] = useState(500);
  const [simulatedTransientFailureRate, setSimulatedTransientFailureRate] =
    useState(0.05);

  const [idempotencyKey, setIdempotencyKey] = useState<string>(() =>
    generateClientIdempotencyKey()
  );

  const [validationReport, setValidationReport] =
    useState<CampaignValidationReport | null>(null);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replayBanner, setReplayBanner] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGenerateMockCsv = (count: number) => {
    setInputMode('csv_text');
    const generated = generateMockCsvDataset(count, channel);
    setCsvText(generated);
    setValidationReport(null);
    setError(null);
  };

  const handleValidatePreview = async () => {
    setValidating(true);
    setError(null);
    try {
      if (inputMode === 'csv_file') {
        if (!csvFile) {
          throw new Error('Please choose a CSV file first.');
        }
        const res = await previewRecipientValidation({
          channel,
          file: csvFile,
        });
        setValidationReport(res.report);
      } else if (inputMode === 'json') {
        const parsed = JSON.parse(jsonText);
        if (!Array.isArray(parsed)) {
          throw new Error('JSON input must be an array of recipients.');
        }
        const res = await previewRecipientValidation({
          channel,
          recipients: parsed,
        });
        setValidationReport(res.report);
      } else {
        const res = await previewRecipientValidation({
          channel,
          csvContent: csvText,
        });
        setValidationReport(res.report);
      }
    } catch (err) {
      setError((err as Error).message || 'Validation failed');
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setReplayBanner(null);

    try {
      let recipientsArray: Array<string | Record<string, unknown>> | undefined;
      if (inputMode === 'json') {
        const parsed = JSON.parse(jsonText);
        if (!Array.isArray(parsed)) {
          throw new Error('JSON recipients must be an array.');
        }
        recipientsArray = parsed;
      }

      const res = await createCampaignRequest({
        idempotencyKey,
        name,
        description,
        channel,
        subject,
        messageTemplate,
        file: inputMode === 'csv_file' ? csvFile : null,
        csvContent: inputMode === 'csv_text' ? csvText : undefined,
        recipients: inputMode === 'json' ? recipientsArray : undefined,
        scheduledAt:
          launchMode === 'scheduled'
            ? new Date(scheduledAt).toISOString()
            : null,
        saveAsDraft: launchMode === 'draft',
        rejectInvalid,
        config: {
          batchSize,
          maxAttempts,
          backoffDelayMs,
          simulatedTransientFailureRate,
          simulatedPermanentFailureRate: 0,
        },
      });

      if (res.idempotentReplay) {
        setReplayBanner(
          `Idempotent Replay Detected! Existing campaign "${res.campaign.name}" (${res.campaign._id}) was returned without creating a duplicate.`
        );
      } else {
        onCreated(res.campaign, res.idempotentReplay);
        onClose();
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to create campaign');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="relative my-8 w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/60 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-white">
              Create & Schedule Notification Campaign
            </h2>
            <p className="text-xs text-slate-400">
              Upload CSV or JSON recipients, validate addresses, configure
              BullMQ batching & retries, and schedule or launch.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="max-h-[82vh] overflow-y-auto p-6 space-y-5"
        >
          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-950/40 p-3.5 text-xs text-rose-200">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {replayBanner && (
            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-3.5 text-xs text-emerald-200">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{replayBanner}</span>
            </div>
          )}

          {/* Row 1: Campaign Name, Channel, Idempotency Key */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Campaign Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Notification Channel *
              </label>
              <select
                value={channel}
                onChange={(e) => {
                  setChannel(e.target.value as CampaignChannel);
                  setValidationReport(null);
                }}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              >
                <option value="email">Email Gateway</option>
                <option value="sms">SMS Gateway (E.164)</option>
                <option value="push">Push Notification</option>
              </select>
            </div>
          </div>

          {/* Row 2: Subject & Message Template */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Subject Line (Email / Push Title)
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Message Template *
            </label>
            <textarea
              rows={2}
              required
              value={messageTemplate}
              onChange={(e) => setMessageTemplate(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Row 3: Recipient Input Mode & Quick 5,000 Mock Generator */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setInputMode('csv_text')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    inputMode === 'csv_text'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  CSV Paste / Generator
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('csv_file')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    inputMode === 'csv_file'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload CSV File
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('json')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    inputMode === 'json'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  <FileText className="h-3.5 w-3.5" />
                  JSON Recipient List
                </button>
              </div>

              {/* 1-Click Mock Recipient Generators */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleGenerateMockCsv(50)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800"
                >
                  <Sparkles className="h-3 w-3 text-indigo-400" />
                  Load 50 Mock
                </button>
                <button
                  type="button"
                  onClick={() => handleGenerateMockCsv(5000)}
                  className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/25"
                >
                  <Sparkles className="h-3 w-3 text-indigo-400" />
                  Generate 5,000 Mock Recipients
                </button>
              </div>
            </div>

            {inputMode === 'csv_text' && (
              <div>
                <textarea
                  rows={5}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder="recipient,name&#10;alice@example.com,Alice"
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2.5 font-mono text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Tip: Addresses containing <code className="text-indigo-300">retry-once</code> simulate transient 429 backoff recovery; addresses containing <code className="text-rose-300">perm-fail</code> simulate permanent 400 hard bounces.
                </p>
              </div>
            )}

            {inputMode === 'csv_file' && (
              <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/50 p-6 text-center">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                  className="text-xs text-slate-300"
                />
                {csvFile && (
                  <p className="mt-2 text-xs text-emerald-400">
                    Selected: {csvFile.name} ({(csvFile.size / 1024).toFixed(1)}{' '}
                    KB)
                  </p>
                )}
              </div>
            )}

            {inputMode === 'json' && (
              <textarea
                rows={5}
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2.5 font-mono text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
              />
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rejectInvalid}
                  onChange={(e) => setRejectInvalid(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 text-indigo-600"
                />
                Strict mode: reject entire upload if any invalid entry exists
              </label>

              <button
                type="button"
                disabled={validating}
                onClick={() => void handleValidatePreview()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-500/20"
              >
                {validating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                Validate & Preview Recipients
              </button>
            </div>

            {/* Validation Breakdown Report */}
            {validationReport && (
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-3 space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded bg-slate-950 p-2">
                    <span className="text-slate-400">Submitted: </span>
                    <strong className="text-white">
                      {validationReport.totalSubmitted.toLocaleString()}
                    </strong>
                  </div>
                  <div className="rounded bg-slate-950 p-2">
                    <span className="text-slate-400">Valid: </span>
                    <strong className="text-emerald-400">
                      {validationReport.validCount.toLocaleString()}
                    </strong>
                  </div>
                  <div className="rounded bg-slate-950 p-2">
                    <span className="text-slate-400">Invalid: </span>
                    <strong className="text-rose-400">
                      {validationReport.invalidCount.toLocaleString()}
                    </strong>
                  </div>
                  <div className="rounded bg-slate-950 p-2">
                    <span className="text-slate-400">Duplicates: </span>
                    <strong className="text-amber-300">
                      {validationReport.duplicateCount.toLocaleString()}
                    </strong>
                  </div>
                </div>

                {validationReport.errors.length > 0 && (
                  <div className="max-h-28 overflow-y-auto rounded border border-slate-800 bg-slate-950 p-2 space-y-1">
                    {validationReport.errors.slice(0, 25).map((errItem, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between text-[11px] text-slate-300"
                      >
                        <span>
                          Row #{errItem.row}:{' '}
                          <code className="text-rose-300">
                            {errItem.recipient}
                          </code>
                        </span>
                        <span className="text-amber-300">{errItem.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Row 4: Scheduling, Queue Batching & Idempotency Key */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-indigo-400" />
                Launch & Scheduling
              </h4>
              <div className="flex flex-wrap gap-2">
                {(['immediate', 'scheduled', 'draft'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setLaunchMode(m)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition ${
                      launchMode === m
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-900 text-slate-400 hover:text-white'
                    }`}
                  >
                    {m === 'immediate'
                      ? 'Start Immediately'
                      : m === 'scheduled'
                        ? 'Schedule Future'
                        : 'Save Draft'}
                  </button>
                ))}
              </div>

              {launchMode === 'scheduled' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Scheduled Execution Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white"
                  />
                </div>
              )}

              {/* Idempotency Key Control */}
              <div className="pt-2 border-t border-slate-800/80">
                <label className="block text-[11px] font-medium text-slate-400 mb-1 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1">
                    <KeyRound className="h-3 w-3 text-indigo-400" />
                    Idempotency-Key Header
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setIdempotencyKey(generateClientIdempotencyKey())
                    }
                    className="inline-flex items-center gap-1 text-indigo-400 hover:underline"
                  >
                    <RefreshCw className="h-2.5 w-2.5" />
                    New Key
                  </button>
                </label>
                <input
                  type="text"
                  value={idempotencyKey}
                  onChange={(e) => setIdempotencyKey(e.target.value)}
                  className="w-full rounded border border-slate-800 bg-slate-900 px-2.5 py-1 font-mono text-xs text-slate-300"
                />
              </div>
            </div>

            {/* Queue & Backoff Settings */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2.5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                BullMQ Batching & Retry Policy
              </h4>

              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">
                    Batch Size
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={5000}
                    value={batchSize}
                    onChange={(e) => setBatchSize(Number(e.target.value))}
                    className="w-full rounded border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">
                    Max Attempts
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={maxAttempts}
                    onChange={(e) => setMaxAttempts(Number(e.target.value))}
                    className="w-full rounded border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">
                    Backoff Base (ms)
                  </label>
                  <input
                    type="number"
                    min={50}
                    max={10000}
                    value={backoffDelayMs}
                    onChange={(e) => setBackoffDelayMs(Number(e.target.value))}
                    className="w-full rounded border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">
                    Transient Error Rate
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={1}
                    value={simulatedTransientFailureRate}
                    onChange={(e) =>
                      setSimulatedTransientFailureRate(Number(e.target.value))
                    }
                    className="w-full rounded border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-white"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {launchMode === 'immediate'
                ? 'Create & Enqueue Campaign'
                : launchMode === 'scheduled'
                  ? 'Schedule Campaign'
                  : 'Save Campaign Draft'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
