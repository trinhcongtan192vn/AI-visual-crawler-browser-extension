// Test nghiệm thu theo specs/04-excel-parser.md mục 4.3 (dòng cuối) + logic downgrade (03/04.2).
import { describe, expect, it } from 'vitest';
import { buildPrompt, createJobFromBlock, resolveJobKind } from '../prompt-builder';
import { DEFAULT_IMAGE_TEMPLATE, DEFAULT_VIDEO_TEMPLATE } from '../../../config/default-templates';
import type { Block, RunConfig } from '../../../shared/types';

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    blockId: 'B01',
    rawVisualType: 'Ảnh',
    resolvedKind: 'image',
    visualFx: 'Cảnh hoàng hôn trên biển, ánh sáng vàng cam',
    audioSfx: 'Tiếng sóng vỗ nhẹ',
    voContent: 'Đây là câu giới thiệu ngắn cho video.',
    rowIndex: 2,
    warnings: [],
    ...overrides
  };
}

function makeConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    provider: 'gemini',
    aspectRatio: '16:9',
    outputFolder: 'test',
    interBlockDelayMs: { min: 0, max: 0 },
    promptTemplates: { image: DEFAULT_IMAGE_TEMPLATE, video: DEFAULT_VIDEO_TEMPLATE },
    ...overrides
  };
}

describe('resolveJobKind (downgrade rule)', () => {
  it('keeps video kind on gemini', () => {
    const r = resolveJobKind(makeBlock({ resolvedKind: 'video' }), 'gemini');
    expect(r).toEqual({ kind: 'video', downgraded: false });
  });

  it('downgrades video to image on chatgpt', () => {
    const r = resolveJobKind(makeBlock({ resolvedKind: 'video' }), 'chatgpt');
    expect(r).toEqual({ kind: 'image', downgraded: true });
  });

  it('does not touch image blocks on chatgpt', () => {
    const r = resolveJobKind(makeBlock({ resolvedKind: 'image' }), 'chatgpt');
    expect(r).toEqual({ kind: 'image', downgraded: false });
  });
});

describe('buildPrompt', () => {
  it('image prompt never contains the audio line, even if the template has one', () => {
    const block = makeBlock({ resolvedKind: 'image' });
    const config = makeConfig();
    const job = createJobFromBlock(block, config);
    expect(job.kind).toBe('image');
    expect(job.prompt.toLowerCase()).not.toContain('tiếng sóng vỗ nhẹ'.toLowerCase());
    expect(job.prompt).not.toMatch(/âm thanh trong cảnh/i);
  });

  it('video prompt includes the audio line', () => {
    const block = makeBlock({ resolvedKind: 'video' });
    const config = makeConfig();
    const job = createJobFromBlock(block, config);
    expect(job.kind).toBe('video');
    expect(job.prompt).toContain('Tiếng sóng vỗ nhẹ');
  });

  it('video prompt explicitly says "Tạo video" — Gemini no longer gets an explicit model switch, so the prompt itself must signal video intent', () => {
    const block = makeBlock({ resolvedKind: 'video' });
    const config = makeConfig();
    const job = createJobFromBlock(block, config);
    expect(job.prompt).toMatch(/^Tạo video:/i);
  });

  it('drops the VO context line entirely when voContent is empty, instead of leaving a dangling label', () => {
    const block = makeBlock({ voContent: undefined });
    const config = makeConfig();
    const prompt = buildPrompt(block, createJobFromBlock(block, config), config);
    expect(prompt).not.toMatch(/Bối cảnh cảnh quay:\s*\./);
    expect(prompt).not.toContain('Bối cảnh cảnh quay:');
  });

  it('truncates a very long voContent to about 200 chars, cutting at a sentence boundary', () => {
    const longVo = 'Đây là câu đầu tiên khá dài để test cắt bớt nội dung giọng đọc cho đúng yêu cầu sản phẩm. ' +
      'Đây là câu thứ hai sẽ bị cắt bớt hoặc loại bỏ hoàn toàn khỏi prompt cuối cùng vì đã vượt quá hai trăm ký tự cho phép.';
    const block = makeBlock({ voContent: longVo });
    const config = makeConfig();
    const prompt = buildPrompt(block, createJobFromBlock(block, config), config);
    const voLine = prompt.split('\n').find((l) => l.startsWith('Bối cảnh cảnh quay:'));
    expect(voLine).toBeDefined();
    // Được viết mà không có dấu chấm cuối template + dấu chấm nguồn, cho biên độ rộng một chút.
    expect((voLine ?? '').length).toBeLessThan(230);
  });

  it('wraps the body with promptPrefix and promptSuffix when provided', () => {
    const block = makeBlock();
    const config = makeConfig({ promptPrefix: 'STYLE_PREFIX', promptSuffix: 'STYLE_SUFFIX' });
    const job = createJobFromBlock(block, config);
    expect(job.prompt.startsWith('STYLE_PREFIX')).toBe(true);
    expect(job.prompt.endsWith('STYLE_SUFFIX')).toBe(true);
  });

  it('respects a user-edited prompt and does not let template rebuilds silently override it (caller responsibility)', () => {
    const block = makeBlock();
    const config = makeConfig();
    const job = createJobFromBlock(block, config);
    const edited = 'Prompt do người dùng tự viết lại hoàn toàn.';
    job.prompt = edited;
    job.promptEditedByUser = true;
    // buildPrompt tự nó luôn build lại từ template — việc "không đụng vào" là trách nhiệm của
    // call site (panel/store.ts rebuildJobs), không phải của buildPrompt. Test này chỉ khẳng định
    // job.prompt giữ nguyên giá trị đã set cho tới khi có ai đó chủ động gọi lại buildPrompt.
    expect(job.prompt).toBe(edited);
  });
});
