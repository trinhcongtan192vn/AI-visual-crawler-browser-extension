// 04.1 — Excel Parser. Đọc file .xlsx/.csv, ánh xạ cột theo header, validate, phân loại kind.
import * as XLSX from 'xlsx';
import type { Block, ResolvedKind } from '../../shared/types';
import { IMAGE_KEYWORDS, VIDEO_KEYWORDS } from '../../config/visual-keywords';
import { createLogger } from '../../shared/logger';

const log = createLogger('excel-parser');

export interface ParseResult {
  blocks: Block[];
  fileWarnings: string[];
  stats: { total: number; images: number; videos: number; skipped: number };
}

export class ParseError extends Error {
  constructor(message: string, public headersFound: string[]) {
    super(message);
  }
}

type FieldKey = 'blockId' | 'duration' | 'rawVisualType' | 'visualFx' | 'audioSfx' | 'voContent';

const HEADER_MATCHERS: Record<FieldKey, string[]> = {
  blockId: ['mã block', 'ma block', 'block'],
  duration: ['thời lượng', 'thoi luong', 'duration'],
  rawVisualType: ['loại visual', 'loai visual', 'visual type'],
  visualFx: ['hình ảnh', 'visual/fx', 'visual'],
  audioSfx: ['âm thanh', 'audio/sfx', 'audio'],
  voContent: ['giọng đọc', 'vo content', 'vo']
};

const REQUIRED_FIELDS: FieldKey[] = ['blockId', 'rawVisualType', 'visualFx'];

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

function normalizeHeader(h: unknown): string {
  return stripDiacritics(String(h ?? '').toLowerCase().trim().replace(/\s+/g, ' '));
}

function normalizeCell(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v).trim().replace(/[ \t]+/g, ' ');
}

// Thứ tự xử lý: field có matcher CỤ THỂ hơn đi trước và "khóa" cột nó chiếm, để field có
// matcher rộng hơn (VD visualFx khớp cả từ khóa 'visual' đơn lẻ) không cướp nhầm cột đã thuộc
// về field khác. Cụ thể: cột "Loại Visual" chứa substring "visual" nên nếu xử lý visualFx
// trước rawVisualType, nó sẽ nhầm lấy cột "Loại Visual" thay vì cột "Hình ảnh & Hiệu ứng" thật.
const FIELD_MATCH_ORDER: FieldKey[] = ['blockId', 'rawVisualType', 'duration', 'audioSfx', 'voContent', 'visualFx'];

function mapHeaders(headerRow: unknown[]): { columnIndex: Partial<Record<FieldKey, number>>; headersFound: string[] } {
  const headersFound = headerRow.map((h) => String(h ?? ''));
  const normalized = headerRow.map(normalizeHeader);
  const columnIndex: Partial<Record<FieldKey, number>> = {};
  const claimed = new Set<number>();

  FIELD_MATCH_ORDER.forEach((field) => {
    const matchers = HEADER_MATCHERS[field].map(stripDiacritics);
    const idx = normalized.findIndex((h, i) => !claimed.has(i) && matchers.some((m) => h.includes(m)));
    if (idx !== -1) {
      columnIndex[field] = idx;
      claimed.add(idx);
    }
  });

  return { columnIndex, headersFound };
}

function resolveKind(rawVisualType: string): { kind: ResolvedKind; warning?: string } {
  const norm = stripDiacritics(rawVisualType.toLowerCase());
  if (VIDEO_KEYWORDS.some((k) => norm.includes(stripDiacritics(k)))) {
    return { kind: 'video' };
  }
  if (IMAGE_KEYWORDS.some((k) => norm.includes(stripDiacritics(k)))) {
    return { kind: 'image' };
  }
  return { kind: 'image', warning: `Loại Visual '${rawVisualType}' không rõ, mặc định Ảnh` };
}

function sanitizeForFileName(id: string): string {
  return id.replace(/[\\/:*?"<>|]/g, '').trim();
}

export async function parseExcelFile(file: File): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new ParseError('File Excel không có sheet nào.', []);
  }
  const sheet = wb.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });

  if (rows.length === 0) {
    throw new ParseError('File Excel rỗng.', []);
  }

  const [headerRow, ...dataRows] = rows;
  const { columnIndex, headersFound } = mapHeaders(headerRow);

  const missing = REQUIRED_FIELDS.filter((f) => columnIndex[f] === undefined);
  if (missing.length > 0) {
    throw new ParseError(
      `Thiếu cột bắt buộc: ${missing.join(', ')}. Header đọc được: ${headersFound.filter(Boolean).join(', ') || '(rỗng)'}`,
      headersFound
    );
  }

  const fileWarnings: string[] = [];
  const seenIds = new Map<string, number>();
  const blocks: Block[] = [];

  let images = 0;
  let videos = 0;
  let skipped = 0;

  dataRows.forEach((row, i) => {
    const rowIndex = i + 2; // +1 header, +1 for 1-based display
    const get = (f: FieldKey) => (columnIndex[f] !== undefined ? normalizeCell(row[columnIndex[f]!]) : '');

    let blockId = get('blockId');
    if (!blockId) {
      fileWarnings.push(`Hàng ${rowIndex} thiếu Mã block, đã bỏ qua`);
      return;
    }

    if (seenIds.has(blockId)) {
      const count = seenIds.get(blockId)! + 1;
      seenIds.set(blockId, count);
      const original = blockId;
      blockId = `${blockId}_dup${count}`;
      fileWarnings.push(`Mã block '${original}' trùng ở hàng ${rowIndex}, đổi thành '${blockId}'`);
    } else {
      seenIds.set(blockId, 1);
    }

    const rawVisualType = get('rawVisualType');
    const visualFx = get('visualFx');
    const audioSfx = get('audioSfx') || undefined;
    const voContent = get('voContent') || undefined;
    const duration = get('duration') || undefined;

    const { kind, warning } = resolveKind(rawVisualType);
    const warnings: string[] = [];
    if (warning) warnings.push(warning);

    const skip = !visualFx;
    if (skip) {
      warnings.push('Thiếu mô tả Hình ảnh & Hiệu ứng, không đủ để tạo prompt — đã đánh dấu skip');
      skipped++;
    } else if (kind === 'video') {
      videos++;
    } else {
      images++;
    }

    blocks.push({
      blockId,
      duration,
      rawVisualType,
      resolvedKind: kind,
      visualFx,
      audioSfx,
      voContent,
      rowIndex,
      warnings,
      skip,
      skipReason: skip ? 'Thiếu mô tả Hình ảnh & Hiệu ứng' : undefined
    });
  });

  log.info(`Parsed ${blocks.length} blocks (${images} images, ${videos} videos, ${skipped} skipped)`);

  return {
    blocks,
    fileWarnings,
    stats: { total: blocks.length, images, videos, skipped }
  };
}

export { sanitizeForFileName };
