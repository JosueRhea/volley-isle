export class Net {
  constructor() {
    this.handlers = {};
    this.ws = null;
    this.lastMessageAt = 0;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  on(type, fn) {
    this.handlers[type] = fn;
  }

  // path: /ws/<CODE>?mode=… (each room has its own address; on Cloudflare it's its own Durable Object)
  // Resolves once open. A socket that fails before opening only rejects; `close` is for drops after that.
  connect(path, timeoutMs = 10000) {
    this.close();
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}${path}`);
      this.ws = ws;
      let opened = false;
      const timer = setTimeout(() => {
        if (opened) return;
        if (this.ws === ws) this.ws = null;
        ws.close();
        reject(new Error('timeout'));
      }, timeoutMs);
      ws.onopen = () => {
        opened = true;
        clearTimeout(timer);
        this.lastMessageAt = performance.now();
        resolve();
      };
      ws.onerror = () => {};
      ws.onmessage = (e) => {
        this.lastMessageAt = performance.now();
        const msg = JSON.parse(e.data);
        this.handlers[msg.t]?.(msg);
      };
      ws.onclose = (e) => {
        clearTimeout(timer);
        if (!opened) return reject(new Error(`closed ${e.code}`));
        if (this.ws === ws) {
          this.ws = null;
          this.handlers.close?.(e);
        }
      };
    });
  }

  // Our own disconnect: no `close` callback.
  close() {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  // The connection went quiet (half-open socket): give up on it and report it like a drop.
  drop() {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.close();
    this.handlers.close?.({ code: 4999, reason: 'stale' });
  }

  send(msg) {
    if (this.connected) this.ws.send(JSON.stringify(msg));
  }
}
