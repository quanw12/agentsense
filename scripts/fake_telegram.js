// A local stand-in for the Telegram Bot API, for check_telegram.js and smoke_telegram.js.
// Records every call and holds getUpdates open until the test pushes an update, like real long polling.
const http = require('http');

class FakeTelegram {
  constructor(token) {
    this.token = token;
    this.calls = [];
    this.pending = [];
    this.waiter = null;
    this.next_update = 1;
    this.next_message = 1000;
    this.fail_next = new Map(); // method -> { error_code, description, parameters }
    this.server = null;
    this.sockets = new Set();
  }

  start() {
    this.server = http.createServer((request, response) => this.handle(request, response));
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        this.base_url = `http://127.0.0.1:${this.server.address().port}`;
        resolve(this.base_url);
      });
    });
  }

  stop() {
    for (const socket of this.sockets) socket.destroy();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  reply(response, status, body) {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  }

  handle(request, response) {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const match = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(request.url);
      if (!match || match[1] !== this.token) {
        return this.reply(response, 401, { ok: false, error_code: 401, description: 'Unauthorized' });
      }
      const method = match[2];
      const raw = Buffer.concat(chunks);
      const is_json = String(request.headers['content-type'] || '').includes('json');
      const params = is_json && raw.length > 0 ? JSON.parse(raw.toString('utf8')) : { raw: raw.toString('utf8') };
      const failure = this.fail_next.get(method);
      if (failure) {
        this.fail_next.delete(method);
        return this.reply(response, failure.error_code, { ok: false, ...failure });
      }
      if (method === 'getUpdates') return this.hold_updates(params, response);
      this.calls.push({ method, params });
      if (method === 'getMe') return this.reply(response, 200, { ok: true, result: { id: 1, is_bot: true, username: 'fake_bot' } });
      if (method === 'sendMessage' || method === 'sendDocument') {
        return this.reply(response, 200, { ok: true, result: { message_id: this.next_message++ } });
      }
      return this.reply(response, 200, { ok: true, result: true });
    });
  }

  hold_updates(params, response) {
    const offset = Number.isInteger(params.offset) ? params.offset : 0;
    const ready = this.pending.filter((update) => update.update_id >= offset);
    if (ready.length > 0) {
      this.pending = [];
      return this.reply(response, 200, { ok: true, result: ready });
    }
    this.waiter = response;
    return undefined;
  }

  push(update) {
    const full = { update_id: this.next_update++, ...update };
    if (this.waiter && !this.waiter.destroyed && !this.waiter.writableEnded) {
      const response = this.waiter;
      this.waiter = null;
      return this.reply(response, 200, { ok: true, result: [full] });
    }
    this.pending.push(full);
    return undefined;
  }

  // An empty answer to the open poll, so the bot records that it is online.
  flush() {
    if (this.waiter) {
      const response = this.waiter;
      this.waiter = null;
      this.reply(response, 200, { ok: true, result: [] });
    }
  }

  sent(method) {
    return this.calls.filter((call) => call.method === (method || 'sendMessage'));
  }

  // The text of everything the bot has said, for simple "did it say this" checks.
  said() {
    return this.sent('sendMessage').map((call) => call.params.text);
  }
}

module.exports = { FakeTelegram };
