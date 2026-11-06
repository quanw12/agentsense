// Thin client for the Telegram Bot API, on the global fetch. Long polling only talks outward, so the bot needs
// no open port and works from any network the PC has. Errors never carry the token: it is part of every URL.
const API_BASE = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 30 * 1000;

class TelegramError extends Error {
  constructor(message, fields) {
    super(message);
    this.name = 'TelegramError';
    const extra = fields || {};
    this.code = extra.code === undefined ? null : extra.code; // Telegram error_code; null for a network failure
    this.retry_after = extra.retry_after === undefined ? null : extra.retry_after;
  }
}

class TelegramApi {
  // options: { token, base_url, fetch_impl }. base_url and fetch_impl exist for the tests.
  constructor(options) {
    const opts = options || {};
    this.token = typeof opts.token === 'string' ? opts.token : '';
    this.base_url = typeof opts.base_url === 'string' ? opts.base_url.replace(/\/+$/, '') : API_BASE;
    this.fetch_impl = typeof opts.fetch_impl === 'function' ? opts.fetch_impl : (...args) => fetch(...args);
  }

  redact(text) {
    const value = String(text);
    return this.token ? value.split(this.token).join('<token>') : value;
  }

  // Returns the "result" field. Throws TelegramError on an API error or a network failure.
  async request(method, init, options) {
    const opts = options || {};
    const timeout = AbortSignal.timeout(opts.timeout_ms || REQUEST_TIMEOUT_MS);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    let response = null;
    let body = null;
    try {
      response = await this.fetch_impl(`${this.base_url}/bot${this.token}/${method}`, { ...init, signal });
      body = await response.json();
    } catch (error) {
      const failure = new TelegramError(this.redact(`${method}: ${error && error.message ? error.message : error}`));
      failure.aborted = Boolean(opts.signal && opts.signal.aborted);
      throw failure;
    }
    if (!body || body.ok !== true) {
      const description = body && body.description ? body.description : `HTTP ${response.status}`;
      throw new TelegramError(this.redact(`${method}: ${description}`), {
        code: body && Number.isInteger(body.error_code) ? body.error_code : response.status,
        retry_after: body && body.parameters && Number.isFinite(body.parameters.retry_after) ? body.parameters.retry_after : null,
      });
    }
    return body.result;
  }

  call(method, params, options) {
    return this.request(
      method,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {}) },
      options
    );
  }

  get_me() {
    return this.call('getMe');
  }

  // The poll must be able to outlive Telegram's own long-poll timeout.
  get_updates(offset, timeout_seconds, signal) {
    return this.call(
      'getUpdates',
      { offset, timeout: timeout_seconds, allowed_updates: ['message', 'callback_query'] },
      { signal, timeout_ms: (timeout_seconds + 15) * 1000 }
    );
  }

  send_document(chat_id, file_name, content, caption) {
    const form = new FormData();
    form.append('chat_id', String(chat_id));
    if (caption) form.append('caption', caption);
    form.append('document', new Blob([content], { type: 'text/plain' }), file_name);
    return this.request('sendDocument', { method: 'POST', body: form }, { timeout_ms: 120 * 1000 });
  }
}

module.exports = { TelegramApi, TelegramError };
