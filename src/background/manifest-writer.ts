// 07.4 — Manifest writer. Ghi CSV đối soát khi batch xong hoặc user yêu cầu xuất.
import type { BatchState, Job, ManifestRecord, RunConfig } from '../shared/types';
import { createLogger } from '../shared/logger';

const log = createLogger('manifest-writer');

const MAX_PROMPT_LEN = 500;

export function recordJob(batch: BatchState, job: Job, config: RunConfig): void {
  const record: ManifestRecord = {
    blockId: job.blockId,
    originalKind: job.originalKind,
    executedKind: job.kind,
    downgraded: job.downgraded,
    provider: config.provider,
    aspectRatio: config.aspectRatio,
    status: job.status,
    attempts: job.attempts,
    outputFileName: job.outputFileName,
    errorType: job.lastError?.type,
    promptUsed: job.prompt,
    timestamp: Date.now()
  };
  batch.manifestRecords.push(record);
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function truncatePrompt(p: string): string {
  return p.length > MAX_PROMPT_LEN ? p.slice(0, MAX_PROMPT_LEN) + '…' : p;
}

export function buildManifestCsv(batch: BatchState): string {
  const header = [
    'blockId', 'originalKind', 'executedKind', 'downgraded', 'provider', 'aspectRatio',
    'status', 'attempts', 'outputFileName', 'errorType', 'promptUsed', 'timestamp'
  ];
  const lines = [header.join(',')];

  for (const r of batch.manifestRecords) {
    const row = [
      r.blockId,
      r.originalKind,
      r.executedKind,
      String(r.downgraded),
      r.provider,
      r.aspectRatio,
      r.status,
      String(r.attempts),
      r.outputFileName ?? '',
      r.errorType ?? '',
      truncatePrompt(r.promptUsed),
      new Date(r.timestamp).toISOString()
    ].map((v) => csvEscape(String(v)));
    lines.push(row.join(','));
  }

  const BOM = '﻿';
  return BOM + lines.join('\r\n');
}

export async function exportManifest(batch: BatchState): Promise<void> {
  const csv = buildManifestCsv(batch);
  const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  await chrome.downloads.download({
    url: dataUrl,
    filename: `${batch.config.outputFolder}/manifest.csv`,
    conflictAction: 'overwrite',
    saveAs: false
  });
  log.info(`Exported manifest.csv (${batch.manifestRecords.length} records)`);
}
