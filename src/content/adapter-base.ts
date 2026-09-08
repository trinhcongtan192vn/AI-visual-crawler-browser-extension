// 06.1 — Interface chung cho provider adapter.
import type { AspectRatio, ErrorType, Provider, ResolvedKind } from '../shared/types';
import type { SelectorProfile } from './selectors';

export interface GenerateOutcome {
  mediaUrl: string;
  mediaType: 'png' | 'mp4';
  captureMode: 'url' | 'page-triggered';
}

export interface ProviderAdapter {
  provider: Provider;
  isLoggedIn(selectorOverrides?: Partial<SelectorProfile> | null): boolean;
  /** Thực hiện 1 lần tạo, trả media URL để worker tải. Throw AdapterError khi lỗi. */
  generate(req: {
    requestId: string;
    prompt: string;
    kind: ResolvedKind;
    aspectRatio: AspectRatio;
    signal: AbortSignal;
    selectorOverrides?: Partial<SelectorProfile> | null;
  }): Promise<GenerateOutcome>;
}

export class AdapterError extends Error {
  constructor(public errorType: ErrorType, message: string) {
    super(message);
  }
}
