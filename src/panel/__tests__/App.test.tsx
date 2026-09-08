// Smoke test: mount toàn bộ side panel như trình duyệt thật sẽ làm.
// Regression cho lỗi đã gặp: useStore((s) => ({...})) tạo object mới mỗi lần gọi làm
// useSyncExternalStore không ổn định snapshot -> React throw "Too many re-renders" ->
// không có Error Boundary -> #root trống trơn (màn hình trắng). Test này render thật qua
// jsdom nên sẽ fail ngay nếu lỗi đó quay lại, thay vì chỉ được phát hiện khi mở extension thật.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../App';
import { ErrorBoundary } from '../ErrorBoundary';

describe('App (side panel root)', () => {
  it('renders the Import screen without crashing and without hitting the ErrorBoundary', () => {
    render(
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    );

    // Nếu render lỗi (vd useSyncExternalStore snapshot không ổn định), ErrorBoundary sẽ
    // hiện tiêu đề lỗi này thay vì màn Import — assert phủ định để bắt cả trường hợp đó.
    expect(screen.queryByText('Đã xảy ra lỗi khi hiển thị panel')).toBeNull();

    // Màn mặc định khi mở panel lần đầu là Import.
    expect(screen.getByText('Nhập file kịch bản Excel')).toBeTruthy();
    expect(screen.getByText('AI Visual Generator')).toBeTruthy();
  });
});
