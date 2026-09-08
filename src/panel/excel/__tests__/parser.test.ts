// Test nghiệm thu theo specs/04-excel-parser.md mục 4.3.
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseExcelFile, ParseError } from '../parser';

const HEADERS = ['Mã block', 'Thời lượng', 'Loại Visual', 'Hình ảnh & Hiệu ứng (Visual/FX)', 'Âm thanh & Nhạc nền (Audio/SFX)', 'Kịch bản Giọng đọc (VO Content)'];

function makeFile(rows: unknown[][], headers: string[] = HEADERS): File {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new File([buf], 'test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

describe('parseExcelFile', () => {
  it('parses a well-formed file with correct counts and kinds', async () => {
    const file = makeFile([
      ['B01', '5s', 'Ảnh tĩnh', 'Cảnh hoàng hôn trên biển', '', 'Giới thiệu video'],
      ['B02', '8s', 'Video 8s', 'Drone bay qua thành phố', 'Nhạc điện tử sôi động', 'Cảnh mở đầu']
    ]);
    const result = await parseExcelFile(file);
    expect(result.blocks).toHaveLength(2);
    expect(result.stats).toEqual({ total: 2, images: 1, videos: 1, skipped: 0 });
    expect(result.blocks[0].resolvedKind).toBe('image');
    expect(result.blocks[1].resolvedKind).toBe('video');
    // Cột "Hình ảnh & Hiệu ứng" phải map đúng, KHÔNG được lẫn với cột "Loại Visual"
    // (cả hai đều chứa từ "visual" trong header — xem regression test bên dưới).
    expect(result.blocks[0].visualFx).toBe('Cảnh hoàng hôn trên biển');
    expect(result.blocks[1].visualFx).toBe('Drone bay qua thành phố');
    expect(result.blocks[0].rawVisualType).toBe('Ảnh tĩnh');
  });

  it('regression: does not let "Loại Visual" column (which also contains the substring "visual") steal the visualFx column when it appears first', async () => {
    // Thứ tự cột đúng như PRD: Loại Visual (cột 3) đứng TRƯỚC Hình ảnh & Hiệu ứng (cột 4).
    const file = makeFile([['B01', '5s', 'Ảnh tĩnh', 'Cảnh hoàng hôn trên biển, chi tiết đẹp', '', 'VO text']]);
    const result = await parseExcelFile(file);
    expect(result.blocks[0].visualFx).toBe('Cảnh hoàng hôn trên biển, chi tiết đẹp');
    expect(result.blocks[0].rawVisualType).toBe('Ảnh tĩnh');
    expect(result.blocks[0].visualFx).not.toBe(result.blocks[0].rawVisualType);
  });

  it('maps columns correctly even when header order is shuffled', async () => {
    const shuffled = ['Kịch bản Giọng đọc (VO Content)', 'Mã block', 'Hình ảnh & Hiệu ứng (Visual/FX)', 'Loại Visual', 'Âm thanh & Nhạc nền (Audio/SFX)', 'Thời lượng'];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([shuffled, ['VO text', 'B01', 'Visual desc', 'Ảnh', 'Audio desc', '5s']]);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const file = new File([buf], 'shuffled.xlsx');

    const result = await parseExcelFile(file);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].blockId).toBe('B01');
    expect(result.blocks[0].visualFx).toBe('Visual desc');
    expect(result.blocks[0].voContent).toBe('VO text');
  });

  it('skips rows with empty blockId and records a file warning', async () => {
    const file = makeFile([
      ['B01', '', 'Ảnh', 'Cảnh A', '', ''],
      ['', '', 'Ảnh', 'Cảnh B (không có mã block)', '', '']
    ]);
    const result = await parseExcelFile(file);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].blockId).toBe('B01');
    expect(result.fileWarnings.some((w) => w.includes('thiếu Mã block'))).toBe(true);
  });

  it.each([
    ['Video 8s', 'video'],
    ['Ảnh tĩnh', 'image'],
    ['abc', 'image']
  ])('classifies rawVisualType "%s" as %s', async (raw, expectedKind) => {
    const file = makeFile([['B01', '', raw, 'Mô tả', '', '']]);
    const result = await parseExcelFile(file);
    expect(result.blocks[0].resolvedKind).toBe(expectedKind);
    if (raw === 'abc') {
      expect(result.blocks[0].warnings.some((w) => w.includes('không rõ'))).toBe(true);
    }
  });

  it('throws ParseError when required columns are missing', async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([['Foo', 'Bar'], ['x', 'y']]);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const file = new File([buf], 'bad.xlsx');

    await expect(parseExcelFile(file)).rejects.toBeInstanceOf(ParseError);
  });

  it('flags duplicate blockId with a suffix instead of silently overwriting', async () => {
    const file = makeFile([
      ['B01', '', 'Ảnh', 'Cảnh A', '', ''],
      ['B01', '', 'Ảnh', 'Cảnh A lặp lại', '', '']
    ]);
    const result = await parseExcelFile(file);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].blockId).toBe('B01');
    expect(result.blocks[1].blockId).toBe('B01_dup2');
  });
});
