// ipcMain handlers for the mobile-access control panel (mobile_panel.js), plus the two things that need
// Electron here: powerSaveBlocker ("keep the PC awake") and the LAN/Tailscale addresses for the pairing URLs.
// Also wires the mobile server's pane events to the renderer broadcast, so a pane created or closed from
// the phone shows up on the desktop right away.
const { ipcMain, powerSaveBlocker } = require('electron');
const os = require('os');
const qrcode = require('qrcode');

const mobile_settings = require('./mobile_settings');
const { get_mobile_server } = require('./mobile_server');
const { broadcast } = require('./ipc_terminals');

let saver_id = null;

// IPv4 addresses a phone could reach: the LAN adapters and virtual ones like Tailscale (100.x).
// Loopback is skipped; the panel shows the loopback URL itself when nothing else is available.
function lan_addresses() {
  const result = [];
  const interfaces = os.networkInterfaces();
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!Array.isArray(addresses)) continue;
    for (const entry of addresses) {
      if (!entry || entry.internal || entry.family !== 'IPv4' || typeof entry.address !== 'string') continue;
      result.push({ name, address: entry.address });
    }
  }
  return result;
}

function pairing_url(connection, address) {
  return `http://${address}:${connection.port}/m/${connection.token}/`;
}

async function build_state() {
  const file_path = mobile_settings.default_file_path();
  const settings = mobile_settings.read_settings(file_path);
  const server = get_mobile_server();
  const connection = server.get_connection();
  const urls = connection
    ? lan_addresses().map((entry) => ({ label: entry.name, url: pairing_url(connection, entry.address) }))
    : [];
  // The panel pairs by QR; with no LAN address (offline machine) the loopback URL still works for tests.
  const primary = urls.length > 0 ? urls[0].url : connection ? pairing_url(connection, '127.0.0.1') : null;
  let qr_svg = null;
  if (primary) {
    try {
      qr_svg = await qrcode.toString(primary, { type: 'svg', margin: 1, errorCorrectionLevel: 'L' });
    } catch (error) {
      qr_svg = null;
    }
  }
  return {
    enabled: settings.enabled,
    running: Boolean(connection),
    port: connection ? connection.port : settings.port || null,
    bind_all: settings.bind_all,
    keep_awake: settings.keep_awake,
    token: settings.token,
    urls,
    qr_svg,
    clients: server.client_count(),
  };
}

// Starts (or restarts) the server from the settings file. A port kept from an earlier run is tried first;
// when something else took it, a free port is picked and saved, so the URL stays as stable as possible.
async function start_from_settings() {
  const file_path = mobile_settings.default_file_path();
  const settings = mobile_settings.read_settings(file_path);
  const server = get_mobile_server();
  let connection = null;
  try {
    connection = await server.start({ port: settings.port, bind_all: settings.bind_all, token: settings.token });
  } catch (error) {
    if (settings.port === 0) throw error;
    connection = await server.start({ port: 0, bind_all: settings.bind_all, token: settings.token });
  }
  const current = mobile_settings.read_settings(file_path);
  if (current.port !== connection.port) {
    mobile_settings.write_settings(file_path, { ...current, port: connection.port });
  }
  update_saver();
  return connection;
}

async function stop_server() {
  await get_mobile_server().stop();
  update_saver();
}

// prevent-app-suspension keeps the system from idling to sleep while the phone may still be connected.
function update_saver() {
  const file_path = mobile_settings.default_file_path();
  const settings = mobile_settings.read_settings(file_path);
  const wanted = settings.enabled && settings.keep_awake && Boolean(get_mobile_server().get_connection());
  if (wanted && saver_id === null) {
    saver_id = powerSaveBlocker.start('prevent-app-suspension');
  } else if (!wanted && saver_id !== null) {
    powerSaveBlocker.stop(saver_id);
    saver_id = null;
  }
}

function register_mobile_ipc() {
  ipcMain.handle('mobile:get_state', () => build_state());

  ipcMain.handle('mobile:set_enabled', async (_event, enabled) => {
    const file_path = mobile_settings.default_file_path();
    const settings = mobile_settings.write_settings(file_path, {
      ...mobile_settings.read_settings(file_path),
      enabled: enabled === true,
    });
    if (settings.enabled) {
      await start_from_settings();
    } else {
      await stop_server();
    }
    return build_state();
  });

  ipcMain.handle('mobile:set_bind_all', async (_event, bind_all) => {
    const file_path = mobile_settings.default_file_path();
    const settings = mobile_settings.write_settings(file_path, {
      ...mobile_settings.read_settings(file_path),
      bind_all: bind_all === true,
    });
    if (settings.enabled) {
      // The listener has to reopen its socket; connected phones reconnect by themselves.
      await stop_server();
      await start_from_settings();
    }
    return build_state();
  });

  ipcMain.handle('mobile:set_keep_awake', async (_event, keep_awake) => {
    const file_path = mobile_settings.default_file_path();
    mobile_settings.write_settings(file_path, {
      ...mobile_settings.read_settings(file_path),
      keep_awake: keep_awake === true,
    });
    update_saver();
    return build_state();
  });

  ipcMain.handle('mobile:rotate_token', async () => {
    const file_path = mobile_settings.default_file_path();
    const settings = mobile_settings.write_settings(file_path, {
      ...mobile_settings.read_settings(file_path),
      token: mobile_settings.new_token(),
    });
    // Old links die with the socket; every phone has to pair again with the new QR.
    get_mobile_server().set_token(settings.token);
    return build_state();
  });

  // Phone-side pane changes reach the desktop like any other pane event.
  const server = get_mobile_server();
  server.on('terminal_created', (info) => broadcast('terminals:created', info));
  server.on('terminal_killed', ({ terminal_id }) => broadcast('terminals:closed', terminal_id));

  // The server comes back with the app when it was left enabled.
  const settings = mobile_settings.read_settings(mobile_settings.default_file_path());
  if (settings.enabled) {
    start_from_settings().catch((error) => {
      console.error(`mobile server did not start: ${error && error.message ? error.message : error}`);
    });
  }
}

module.exports = { register_mobile_ipc, build_state, lan_addresses };
