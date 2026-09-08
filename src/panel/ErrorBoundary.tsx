import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createLogger } from '../shared/logger';

const log = createLogger('panel-error-boundary');

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.error('Panel crashed', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="screen">
          <h2>Đã xảy ra lỗi khi hiển thị panel</h2>
          <div className="alert alert-error">
            <strong>{this.state.error.message}</strong>
            <div className="small">Mở DevTools (F12) trên side panel để xem chi tiết trong console (log [AVG]).</div>
          </div>
          <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>Thử lại</button>
        </div>
      );
    }
    return this.props.children;
  }
}
