// 04.2 — Prompt Builder. Ghép template + dữ liệu block thành prompt cuối cùng cho một Job.
import type { Block, Job, Provider, ResolvedKind, RunConfig } from '../../shared/types';

const PLACEHOLDER_RE = /\{\{(visualFx|voContent|audioSfx|aspectRatio|duration)\}\}/g;

function truncateVoContent(text: string, maxLen = 200): string {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen);
  const lastSentenceEnd = Math.max(slice.lastIndexOf('.'), slice.lastIndexOf('!'), slice.lastIndexOf('?'));
  if (lastSentenceEnd > 40) return slice.slice(0, lastSentenceEnd + 1);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice) + '…';
}

function removeLinesWithPlaceholder(template: string, placeholder: string): string {
  return template
    .split('\n')
    .filter((line) => !line.includes(`{{${placeholder}}}`))
    .join('\n');
}

function normalizeBlankLines(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Quyết định kind thực thi cho một block dựa trên provider đã chọn (quy tắc downgrade, 03). */
export function resolveJobKind(block: Block, provider: Provider): { kind: ResolvedKind; downgraded: boolean } {
  if (provider === 'chatgpt' && block.resolvedKind === 'video') {
    return { kind: 'image', downgraded: true };
  }
  return { kind: block.resolvedKind, downgraded: false };
}

export function createJobFromBlock(block: Block, config: RunConfig): Job {
  const { kind, downgraded } = resolveJobKind(block, config.provider);
  const job: Job = {
    blockId: block.blockId,
    kind,
    originalKind: block.resolvedKind,
    downgraded,
    prompt: '',
    status: block.skip ? 'skipped' : 'pending',
    attempts: 0
  };
  job.prompt = buildPrompt(block, job, config);
  return job;
}

export function buildPrompt(block: Block, job: Job, config: RunConfig): string {
  let template = job.kind === 'image' ? config.promptTemplates.image : config.promptTemplates.video;

  // Với ảnh: không chèn audioSfx dù template có (yêu cầu sản phẩm 04.2 mục 4).
  if (job.kind === 'image') {
    template = removeLinesWithPlaceholder(template, 'audioSfx');
  }
  if (!block.audioSfx) {
    template = removeLinesWithPlaceholder(template, 'audioSfx');
  }
  if (!block.voContent) {
    template = removeLinesWithPlaceholder(template, 'voContent');
  }
  if (!block.duration) {
    template = removeLinesWithPlaceholder(template, 'duration');
  }

  const values: Record<string, string> = {
    visualFx: block.visualFx ?? '',
    voContent: block.voContent ? truncateVoContent(block.voContent) : '',
    audioSfx: block.audioSfx ?? '',
    aspectRatio: config.aspectRatio,
    duration: block.duration ?? ''
  };

  let body = template.replace(PLACEHOLDER_RE, (_m, key: string) => values[key] ?? '');
  body = normalizeBlankLines(body);

  const parts = [config.promptPrefix?.trim(), body, config.promptSuffix?.trim()].filter(
    (p): p is string => !!p
  );

  return normalizeBlankLines(parts.join('\n\n'));
}
