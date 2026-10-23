export class Net {
  constructor() {
    this.handlers = {};
    this.ws = null;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  on(type, fn) {
    this.handlers[type] = fn;
  }

  // path: /ws/<CODE>?mode=… (each room has its own address; on Cloudflare it's its own Durable Object)
  connect(path) {
    this.close();
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}${path}`);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        this.handlers[msg.t]?.(msg);
      };
      ws.onclose = () => {
        if (this.ws === ws) this.handlers.close?.();
      };
    });
  }

  close() {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  send(msg) {
    if (this.connected) this.ws.send(JSON.stringify(msg));
  }
}
