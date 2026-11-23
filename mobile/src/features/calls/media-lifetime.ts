// A permission dialog or native publication can finish after the screen has closed.
export class MediaLifetime {
  private closed = false;
  readonly done: Promise<void>;
  constructor(
    steps: (() => Promise<unknown>)[],
    private readonly stop: () => Promise<unknown>,
    failed: () => void,
  ) {
    this.done = (async () => {
      try {
        for (const step of steps) {
          if (this.closed) return;
          await step();
        }
      } catch {
        if (!this.closed) failed();
        await stop().catch(() => {});
      } finally {
        if (this.closed) await stop().catch(() => {});
      }
    })();
  }
  async close() {
    this.closed = true;
    await Promise.allSettled([this.stop(), this.done]);
    // Stop again to release anything returned by an in-flight native operation.
    await this.stop().catch(() => {});
  }
}
