// Decides what the mobile panel may offer a phone: which pairing links to list and which one the QR uses.
// No Electron here, so scripts/check_stability.js can test it with a fixed adapter list.
//
// Adapter order from os.networkInterfaces() says nothing about reachability, so addresses are ranked by how
// likely a phone is to reach them. The names are a best guess, so every address stays listed for the user.

// Address tiers, best first. Anything at UNREACHABLE or below never goes in the QR.
const TIER_WIFI = 7;
const TIER_WIRED = 6;
const TIER_PRIVATE = 5;
const TIER_PRIVATE_172 = 4; // A real LAN can use this range, but it is also the usual WSL and Docker range.
const TIER_OVERLAY = 3;
const TIER_OTHER = 2;
const TIER_HOST_ONLY = 1;
const TIER_LINK_LOCAL = 0;
const UNREACHABLE = TIER_HOST_ONLY;

// Adapters that only reach this PC and its virtual machines. Checked before the Wi-Fi and wired names, and
// a plain "vEthernet (My switch)" is left out on purpose: an external Hyper-V switch holds the real LAN address.
const HOST_ONLY_NAME = /\b(wsl|default switch|nat|vmware|vmnet|virtualbox|vbox|hyper-v|docker|bluetooth|loopback)\b/i;
const OVERLAY_NAME = /tailscale|zerotier|wireguard|nordlynx|vpn|\btap\b|\btun\b/i;
const WIFI_NAME = /^(wi-?fi|wlan|wireless)/i;
const WIRED_NAME = /^ethernet/i;

function address_tier(entry) {
  const [a, b] = String(entry.address).split('.').map(Number);
  // A link-local address means the adapter is up without a network, whatever it is called.
  if (a === 169 && b === 254) return TIER_LINK_LOCAL;
  const name = String(entry.name);
  if (HOST_ONLY_NAME.test(name)) return TIER_HOST_ONLY;
  if (OVERLAY_NAME.test(name)) return TIER_OVERLAY;
  if (WIFI_NAME.test(name)) return TIER_WIFI;
  if (WIRED_NAME.test(name)) return TIER_WIRED;
  if (a === 10 || (a === 192 && b === 168)) return TIER_PRIVATE;
  if (a === 172 && b >= 16 && b <= 31) return TIER_PRIVATE_172;
  if (a === 100 && b >= 64 && b <= 127) return TIER_OVERLAY; // The range Tailscale assigns from.
  return TIER_OTHER;
}

// Best first. The sort is stable, so adapters in one tier keep the order the system gave them.
function rank_addresses(addresses) {
  return addresses
    .map((entry) => ({ entry, tier: address_tier(entry) }))
    .sort((left, right) => right.tier - left.tier);
}

function pairing_url(connection, address) {
  return `http://${address}:${connection.port}/m/${connection.token}/`;
}

// connection: what the server is really listening on ({ port, token, bind_all }), or null when stopped.
// Returns { urls: [{ label, url, in_qr }], qr_url, qr_label }. A loopback listener gets nothing: no address
// of this PC is reachable from a phone until the server listens on every interface.
function pairing_targets(connection, addresses) {
  if (!connection || connection.bind_all !== true) return { urls: [], qr_url: null, qr_label: null };
  const ranked = rank_addresses(addresses);
  const best = ranked.length > 0 && ranked[0].tier > UNREACHABLE ? ranked[0].entry : null;
  const urls = ranked.map(({ entry }) => ({
    label: entry.name,
    url: pairing_url(connection, entry.address),
    in_qr: entry === best,
  }));
  return {
    urls,
    qr_url: best ? pairing_url(connection, best.address) : null,
    qr_label: best ? best.name : null,
  };
}

module.exports = { address_tier, rank_addresses, pairing_url, pairing_targets };
