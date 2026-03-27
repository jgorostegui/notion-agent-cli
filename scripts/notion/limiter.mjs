export class ConcurrencyLimiter {
  constructor(defaultConcurrency = 1) {
    this._max = defaultConcurrency;
    this._running = 0;
    this._queue = [];
  }

  async acquire() {
    if (this._running < this._max) {
      this._running++;
      return;
    }
    await new Promise((resolve) => this._queue.push(resolve));
  }

  release() {
    this._running--;
    if (this._queue.length > 0) {
      this._running++;
      this._queue.shift()();
    }
  }
}
