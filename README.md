<div align="center">
  <img src="assets/icon.png" alt="AgentSense" width="120">
  <h1>AgentSense</h1>
  <p><strong>Run and manage CLI coding agents side by side.</strong></p>
  <p>
    <img alt="Electron" src="https://img.shields.io/badge/electron-44.9-47848F?logo=electron&logoColor=white">
    <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%2011%20x64-0078D4?logo=windows11&logoColor=white">
    <img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A520-339933?logo=nodedotjs&logoColor=white">
    <img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg">
  </p>
</div>

---

AgentSense is a desktop cockpit for coding agents: pick a workspace folder, open a
grid of terminal panes, and launch Claude Code, Codex, Cursor Agent, Droid, OpenCode
and friends next to each other — each pane optionally isolated in its own git
worktree. Everything runs locally, works offline and stays on your machine.

## Features

- **Agent panes** — a terminal grid (xterm.js + node-pty) that runs up to 6 seats
  at once, in one window.
- **Agent catalog** — Claude Code, Codex, Gemini CLI, GitHub Copilot, Pi, Hermes Agent, Cursor Agent, Droid, OpenCode,
  DeepSeek Harness, Grok Build, Kimi Code, Antigravity CLI and a plain
  PowerShell terminal. Agents that are not installed yet show their install
  command and can be installed from the launch page. **Run another CLI agent**
  launches any installed command with the same terminal and worktree lifecycle.
- **Presets** — save a seat layout ("2× Claude + 1× Codex") and relaunch the
  whole squad with one click.
- **Per-seat models & third-party APIs** — choose the model (or a third-party
  provider with per-session env injection) for every seat.
- **Right files panel & tabs** — browse files (including dotfiles) on the right;
  click a file to open a preview alongside the terminals. File and agent tabs
  switch instantly; choose **Tab view** for one pane or **Split view** for all
  panes. Drag the explorer divider to resize it. Panel visibility, width and
  view mode survive restart. Shortcuts: **Ctrl+Shift+E** toggles files,
  **Ctrl+Tab / Ctrl+Shift+Tab** switch tabs.
- **Drag files to agents** — drag from the tree, an open file tab, or Windows
  Explorer onto a specific terminal or agent tab. External files are copied
  into that session's working directory (including isolated worktrees), then
  their quoted paths are pasted into its prompt without pressing Enter.
  Existing filenames are preserved with numbered copies. Dropping onto the
  explorer instead copies into the workspace root.
- **Git worktree isolation** — give a pane its own worktree
  (`<repo>.worktrees/<name>`, branch `agentsense/<name>`); nothing is ever
  force-removed.
- **Mobile access** — pair your phone with a QR code and drive the same
  sessions from its browser: watch and type in any pane, start a new agent,
  close a session. See [Mobile access](#mobile-access).
- **Claude Code status hooks** — a local, token-protected HTTP server
  (`127.0.0.1`, random port) turns Claude Code hook events into pane status:
  `working → waiting → done`.
- **Session restore** — panes and saved sessions come back per workspace.
- **Comfort** — Ctrl+ +/-/0 zoom, F11 fullscreen, single-instance launch.
- **Local-first** — data lives in `%APPDATA%\AgentSense`; no account, no
  telemetry, works fully offline.

## Download

> **Coming soon** — the first public release is being prepared. Until then,
> [build from source](#build-from-source) in a few commands.

## Install (from a distribution zip)

1. Unzip the whole zip, then double-click **`Install AgentSense.cmd`**.
2. If Windows shows *"Windows protected your PC"*, click **More info → Run
   anyway** (the app is not code-signed).
3. AgentSense appears in the Start Menu and on the Desktop, installed for your
   Windows user only — no administrator rights needed.
4. To uninstall, double-click **`Uninstall AgentSense.cmd`** (your data in
   `%APPDATA%\AgentSense` is kept).

Coding agents (Claude Code, Codex, …) are installed separately; Claude Code on
Windows needs [Git for Windows](https://git-scm.com/download/win). The plain
**Terminal** pane works without any of them. See [README.txt](README.txt) for
the full step-by-step guide (Tiếng Việt + English).

## Build from source

Requirements: **Node.js ≥ 20** and npm. No Visual Studio needed — the only
native dependency (`node-pty`) ships N-API prebuilds.

```bat
git clone https://github.com/quanw12/AgentSense.git
cd AgentSense
npm install

npm run start        :: run in dev
npm run smoke:workbench :: real Electron/terminal checks for tabs, explorer, drops and worktrees
npm run icons        :: repack build/icon.png + build/icon.ico from assets/icon.png (optional)
npm run dist         :: build dist/win-unpacked with electron-builder
npm run build:app    :: mirror dist/win-unpacked into app/ (the installer payload)
```

Then double-click `Install AgentSense.cmd` (or run `dist\win-unpacked\AgentSense.exe` directly).

`npm run smoke:mobile` starts the mobile access server inside Electron with a
temp profile and runs an end-to-end check (auth, attach, input, create, kill).

The feature-by-feature comparison with the Orca references, validation details,
and current limits are in [docs/orca-workbench.md](docs/orca-workbench.md).

## Mobile access

AgentSense can serve a touch-friendly web UI from the desktop, so your phone
becomes a remote control for the sessions running on your PC.

1. Click the **phone icon** in the sidebar header and turn on **Enable mobile
   access**.
2. Scan the QR code with your phone (or copy one of the links) — the link
   contains a random pairing token, stored in `%APPDATA%\AgentSense\mobile.json`.
3. The phone opens a session list; tap a session to get a full-screen terminal
   with a quick-keys bar (Esc / Tab / arrows / `^C` / `^D` / Enter). Toggle
   **Line** to type a whole line per Enter — the most reliable way to type on a
   phone keyboard, and it doubles as the paste path. **+ New** starts a new
   agent in any workspace; panes created on the phone appear on the desktop
   right away, and the other way round.
4. While mobile access is on you can enable **Keep the PC awake**, so a session
   does not die when the PC idles.

Where the phone can reach the PC:

- **Same Wi-Fi / LAN** — works out of the box ("Reachable from other devices"
  on). The first start may ask to allow AgentSense through Windows Firewall —
  allow it on private networks.
- **Away from home (street, train, another city)** — install
  [Tailscale](https://tailscale.com) (free) on **this PC and your phone**, log
  into the same tailnet, and keep "Reachable from other devices" on. The phone
  then reaches the PC by its Tailscale address (`100.x.x.x`, listed in the
  panel) over an encrypted WireGuard tunnel. **Do not port-forward this page
  to the internet**: the page is plain HTTP and is meant for LAN/VPN use.

Security: every request (page and WebSocket) requires the 32-hex pairing token,
compared constant-time; three wrong tokens lock new connections out for 30
seconds. **Rotate pairing token** invalidates the old QR and link (all phones
must pair again). The phone can only pick workspaces and agents you already
configured on the desktop — it never sends filesystem paths. Desktop and phone
can drive the same pane at the same time (last writer wins), like two people
sharing one keyboard.

## Project layout

```
main.js / preload.js     Electron main process + contextBridge API (window.hub)
src/main/                pty manager, workspaces, sessions, worktrees, hook server,
                         mobile access server, state store
src/renderer/            UI: sidebar, launch page, terminal grid, file panel, dashboard,
                         mobile access panel (vanilla JS + xterm)
src/mobile/              the phone page served by the mobile access server (vanilla JS + xterm)
assets/                  brand mark (icon.png 512 + icon-256.png for the .ico)
build/                   app icons (generated: npm run icons)
scripts/                 build helpers (payload mirror, icon packing) + smoke tests
app/                     generated Electron payload shipped in the distribution zip
install.ps1 / uninstall.ps1 + Install/Uninstall .cmd   per-user installer
```

## Contributing

Issues and PRs are welcome. Short version: branch per task
(`feat/…`, `fix/…`, `docs/…`, `build/…`, `chore/…`), conventional commits,
merge with `--no-ff`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Tiếng Việt

**AgentSense** là bàn điều khiển desktop cho các coding agent: chọn workspace,
mở lưới terminal nhiều pane và chạy Claude Code, Codex, Cursor Agent, Droid,
OpenCode… cạnh nhau — mỗi pane có thể nằm riêng trong một git worktree. Mọi thứ
chạy local, dùng được offline và không gửi dữ liệu đi đâu.

- **Pane agent** — lưới terminal (xterm.js + node-pty), tối đa 6 chỗ ngồi một lúc.
- **Thư viện agent** — Claude Code, Codex, Cursor Agent, Droid, OpenCode,
  DeepSeek Harness, Grok Build, Kimi Code, Antigravity CLI và Terminal thuần
  (PowerShell). Agent nào chưa cài sẽ hiện sẵn lệnh cài.
- **Model & API theo từng chỗ ngồi** — chọn model hoặc API bên thứ ba
  (env injection riêng cho từng phiên) cho mỗi pane.
- **Panel file của workspace** — duyệt cây thư mục bên cạnh các pane, mở file
  ra xem, và kéo-thả file từ Explorer: thả vào panel để copy vào workspace,
  thả vào pane CLI để copy vào workspace và dán luôn path vào dòng lệnh.
- **Preset** — lưu cách xếp chỗ (vd. "2 Claude + 1 Codex"), lần sau bật lại
  một click.
- **Git worktree riêng cho từng pane** — codex/claude không giẫm chân nhau.
- **Truy cập từ điện thoại (Mobile access)** — quét QR để điều khiển các phiên
  đang chạy từ browser của điện thoại: xem, gõ, mở agent mới, đóng phiên. Ngoài
  mạng nhà dùng Wi-Fi; ra đường thì cài Tailscale trên PC và điện thoại. Chi
  tiết ở mục [Mobile access](#mobile-access).
- **Hook trạng thái Claude Code** — pane hiện `working → waiting → done` qua
  một HTTP server local (127.0.0.1, có token).
- **Local-first** — dữ liệu nằm ở `%APPDATA%\AgentSense`, không cần tài khoản.

**Cài từ zip:** giải nén → nhấp đúp `Install AgentSense.cmd` → nếu Windows cảnh
báo thì *More info → Run anyway* (app chưa ký số). Gỡ: `Uninstall
AgentSense.cmd` (dữ liệu được giữ lại). Chi tiết từng bước xem [README.txt](README.txt).

**Build từ nguồn:** cần Node.js ≥ 20 — `npm install` → `npm run start` (chạy thử)
→ `npm run dist` (đóng gói) → `npm run build:app` (tạo thư mục `app/` cho zip) →
nhấp đúp `Install AgentSense.cmd`.

## License

[MIT](LICENSE) © Anh Quân (quanw12)
