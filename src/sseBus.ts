type SseHandler = (userId: number, event: string, data: unknown) => void;

let sseHandler: SseHandler | null = null;

export function registerSseHandler(handler: SseHandler): void {
  sseHandler = handler;
}

export function pushSse(userId: number, event: string, data: unknown): void {
  if (sseHandler) {
    sseHandler(userId, event, data);
  }
}
