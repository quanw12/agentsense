# AgentSense — kết quả thực hiện và bàn giao review

Người thực hiện: Grok 4.7. Người review: Codex. Không push, không merge, không phát hành.

## 1. Metadata

- HANDOFF_STATE: READY_FOR_CODEX_REVIEW
- IMPLEMENTATION_STATUS: PARTIAL
- PUBLIC_RELEASE_READINESS: NOT_READY
- CODEX_REVIEW_STATE: AWAITING_REREVIEW
- Ngày: 2026-11-03
- Repo root: `C:\StudyBase\AgentSense`
- OS / CPU: Windows 10.0.26300, x64. Node v24.11.1, npm 11.6.3, Electron 44.9.0
- Branch local: `fix/workbench-stability`
- Local commits: `03dda35`, `78f9e35`, `0260de4`, `4edad8c`, `53a24d5`, rồi commit ghi SHA này
- HEAD lúc bắt đầu: `94257b12aabe4dcb2ec48e1c2c6a74a37c71e1fa` (`main`, khớp baseline audit)
- BASE_SHA dùng để review: `94257b12aabe4dcb2ec48e1c2c6a74a37c71e1fa`
- Git status trước khi làm: `main` sạch ngoài các file handoff chưa track (`grok-4.7-prompt.md`, `stabilization-*.md`, `codex-review-prompt.md`, `docs/handoffs/stabilization/`)
- Những thao tác remote đã thực hiện: NONE

Trạng thái dưới đây không phải PASS của public release. `FIXED_VERIFIED` chỉ dùng khi tiêu chí của mục đã có bằng chứng. Phần còn lại để `IMPLEMENTED_NOT_VERIFIED`, `NOT_RUN` hoặc `BLOCKED`.

## 2. Ma trận

| ID | Phạm vi | Trạng thái | Test/evidence | Còn thiếu |
| --- | --- | --- | --- | --- |
| T01 | Focus không đổi geometry | IMPLEMENTED_NOT_VERIFIED | smoke: 3 pane, 20 lần click + double-click, bounds lệch ≤ 1px, không còn nút Tab view | Chưa chạy riêng 2/4/6 pane, chưa chứng minh không tạo lại PTY, chưa nạp profile fixture `mode=tabs` |
| T02 | Layout theo workspace | IMPLEMENTED_NOT_VERIFIED | R4 fixture trong cùng process: hai pane cold-restore `0.7026` so với `0.7` | Chưa đóng/mở app thật với 2/4/6 pane, chưa hai workspace khác layout, chưa nhóm file qua relaunch |
| T03 | Một vùng file, nhiều tab | IMPLEMENTED_NOT_VERIFIED | Smoke: text + image dùng một `.tg-file-pane` | Chưa mở 20 file, chưa chụp overlap |
| T04 | State tách theo workspace | IMPLEMENTED_NOT_VERIFIED | Workspace mới vẫn mở Files khi workspace kia đang ẩn panel | Chưa kéo divider A rồi đối chiếu B sau relaunch |
| T05 | Model/provider id, không lưu secret | IMPLEMENTED_NOT_VERIFIED | `npm run check`: record bỏ `api_key`/`env_extra`; key giả không nằm trong providers.json | Chưa mock CLI in model sau relaunch. Real provider NOT_RUN |
| T06 | Giữ worktree khi restart | IMPLEMENTED_NOT_VERIFIED | R6: sau `exit` rồi Restart, `pty.list_terminals()` và `sessions.json` cùng path/branch/repo/base_commit. Không tạo worktree mới | Chưa worktree bẩn, chưa reload renderer và relaunch app sau restart |
| T07 | Giữ phiên restore lỗi | IMPLEMENTED_NOT_VERIFIED | Restore lỗi không gọi discard; có Forget | Chưa fixture folder mất / CLI thiếu rồi có lại |
| T08 | Resume theo CLI | IMPLEMENTED_NOT_VERIFIED | Bảng capability; chỉ Claude có `--resume` đã biết | Hội thoại thật NOT_RUN. Không bịa flag cho CLI khác |
| T09 | Preset đủ seat | IMPLEMENTED_NOT_VERIFIED | Seat object gồm model/provider/worktree; tên trùng bị từ chối trong code | Chưa save/load/relaunch UI |
| T10 | File tree theo worktree | IMPLEMENTED_NOT_VERIFIED | R5: mousedown trong terminal worktree đổi `.fp-title` sang đúng worktree | Chưa hai worktree với `src/foo.js` khác nhau; chưa Ctrl+Tab/sidebar/quick-open/Open/Reveal |
| T11 | Drop đúng relative path | IMPLEMENTED_NOT_VERIFIED | Smoke: worktree không tạo `brief (1).txt`; file ngoài vào `.agentsense-import` | Chưa đủ dấu/khoảng trắng/target đóng giữa chừng |
| T12 | Ma trận CLI | IMPLEMENTED_NOT_VERIFIED | Contract: 14 id khớp `cli_capabilities.js`. Codex không nhận env model đoán | Chưa launch/chat CLI thật |
| T13 | Editor không giữ nội dung cũ | IMPLEMENTED_NOT_VERIFIED | R1: file 614400 byte được nạp đủ, save còn 614404. R2: conflict rồi đổi tab vẫn còn `MY UNSAVED EDIT`. Node check giữ đuôi, UTF-8, BOM/CRLF và từ chối preview cắt | Chưa đóng tab trước debounce và gõ trong lúc write trên UI |
| T14 | Watch cây file | IMPLEMENTED_NOT_VERIFIED | `files:watch` debounce, bỏ `node_modules`/`.git` | Chưa đo burst |
| T15 | Giữ expansion | IMPLEMENTED_NOT_VERIFIED | `refresh_preserve` giữ scroll/selection trong code | Chưa test 3 tầng |
| T16 | Import không cắt âm thầm | IMPLEMENTED_NOT_VERIFIED | check: 101 mục đều ok; 250 mục reject cả batch, không copy | Chưa đối chiếu số trên UI |
| T17 | IO không chặn main | IMPLEMENTED_NOT_VERIFIED | copy/list/search dùng fs.promises | Chưa đo event-loop |
| T18 | API key sealed | IMPLEMENTED_NOT_VERIFIED | R3: codec unavailable, đổi tên bị reject, file legacy giữ `api_key`. Node check: xóa provider khác và seal throw cũng không ghi đè file | safeStorage thật lỗi NOT_RUN. Không có fallback plaintext |
| T19 | Junction không thoát root | IMPLEMENTED_NOT_VERIFIED | check: junction ra ngoài bị `read_file` từ chối | Chưa symlink nằm trong root; chưa Open/Reveal |
| T20 | Một chủ PTY size | IMPLEMENTED_NOT_VERIFIED | Mobile resize không áp khi có cửa sổ desktop | Chưa 2 WebSocket và chưa máy thật |
| T21 | Rate limit theo nguồn | IMPLEMENTED_NOT_VERIFIED | check: A lock, B không. Smoke mobile: cùng nguồn vẫn lock sau 3 token sai | Chưa rotate token + expiry trên HTTP |
| T22 | Mobile LAN/VPN | IMPLEMENTED_NOT_VERIFIED | UI/state nói loopback và LAN, không nhận là internet/TLS. APPROACH: không làm cloud | LAN/VPN thật NOT_RUN |
| T23 | ConPTY lifecycle | IMPLEMENTED_NOT_VERIFIED | 20 cycle create/close exit 0. Smoke workbench lần 2 exit 0 | Lần smoke đầu exit `0xC0000005` lúc teardown. Soak 30 phút NOT_RUN |
| T24 | Một nguồn build | IMPLEMENTED_NOT_VERIFIED | `scripts/build_app.mjs` stage rồi swap, ghi `BUILD.json` | Chưa chạy `npm run dist` |
| T25 | Cài đặt có rollback | IMPLEMENTED_NOT_VERIFIED | `install.ps1` stage/swap, từ chối `%APPDATA%` | Chưa cài/nâng cấp/gỡ trong thư mục tạm |
| T26 | Phát hành | xem mục con | local only | Không FIXED_VERIFIED |
| T27 | `npm run dev` trên Windows | IMPLEMENTED_NOT_VERIFIED | `node scripts/dev.js` với `AGENT_HUB_USER_DATA` tạm đã spawn Electron | Chưa `npm start` và chưa exe đóng gói |
| T28 | Editor / quick-open / coverage | xem mục con | smoke UX mới pass | Thiếu máy sạch và CLI thật |

### T26

| Mục con | Trạng thái | Kết quả | Bằng chứng | Còn thiếu |
| --- | --- | --- | --- | --- |
| T26a | IMPLEMENTED_NOT_VERIFIED | Version trong toolbar qua `app:info`; CHANGELOG; manifest khi build | `main.js`, `CHANGELOG.md`, `scripts/build_app.mjs` | Chưa xem UI bản đóng gói |
| T26b | NOT_RUN | Workflow local chỉ `workflow_dispatch`, `contents: read`, không publish. REMOTE_CI=NOT_RUN | `.github/workflows/windows-check.yml` | Không push nên không chạy |
| T26c | NOT_RUN | PUBLICATION=NOT_AUTHORIZED. Repo private, không đổi visibility | mục này | Chủ repo quyết định kênh tải |
| T26d | BLOCKED | SIGNING=BLOCKED. Manifest ghi `unsigned` | không có cert | Certificate |
| T26e | NOT_RUN | Không có auto-updater. Cài/nâng cấp vẫn là installer tay. AUTO_UPDATE_PRODUCTION=NOT_RUN | `install.ps1` | Không coi tài liệu là updater |
| T26f | NOT_RUN | APPROACH/SCOPE: chỉ nhắm Windows x64. macOS/Linux không được công bố | `BUILD.json` platform `win32-x64` | Chưa máy sạch |

### T28

| Mục con | Trạng thái | Kết quả | Bằng chứng | Còn thiếu |
| --- | --- | --- | --- | --- |
| T28a | IMPLEMENTED_NOT_VERIFIED | R1/R2 pass trên UI fixture. Conflict kiểm mtime trước khi chặn preview cắt | `scripts/codex_review_regressions.js` exit 0 | Chưa đủ close-tab và write đang chạy trên UI |
| T28b | IMPLEMENTED_NOT_VERIFIED | Quick-open đọc root hiện tại lúc gõ, không đóng root lần tạo overlay | `open_quick_open` | Chưa bấm Ctrl+P sau khi đổi worktree |
| T28c | IMPLEMENTED_NOT_VERIFIED | Smoke workbench/mobile và lifecycle vẫn pass. Fixture R1–R6 exit 0 sau sửa | evidence timestamp bên dưới. Evidence FAIL gốc không sửa | Chưa phủ hết T01–T27 |
| T28d | NOT_RUN | | | Windows sạch, path tiếng Việt, upgrade hai artifact |
| T28e | NOT_RUN | | | CLI/auth thật, phone, sleep/wake, soak |

## 3. Việc đã đổi

- Pane cố định: bỏ Tab view và double-click maximize. `select_tab` chỉ đổi focus. `scrollIntoView` bị bỏ.
- Layout và panel file lưu theo workspace trong `localStorage` key `agentsense.workbench` version 2. `mode=tabs` cũ bị bỏ qua, session không bị xóa.
- File mở trong một nhóm tab. Không tách split mới cho mỗi file.
- Session lưu `model_id`, `provider_id`, `base_cwd`, `resume_mode`, `last_error`. Không lưu env/API key.
- Provider dùng seal. List trả `has_secret`, không trả key. Codec thật là `safeStorage`; test dùng codec giả.
- Restart đóng pane với `keep_worktree` và launch lại đúng `cwd`, không tạo worktree mới.
- Restore lỗi giữ record, có Retry (nút Restart) và Forget.
- Drop trong repo map theo relative path. File đã có thì không overwrite. File ngoài vào `.agentsense-import`.
- `resolve_inside` dùng real path. Junction ra ngoài bị từ chối (đã chạy).
- Rate limit theo địa chỉ. Mobile không resize PTY khi desktop đang hiện.
- `npm run dev` là `node scripts/dev.js`.
- Build và installer stage rồi mới thay bản cũ.

## 4. Lệnh đã chạy

| Lệnh | Kết quả | Ranh giới |
| --- | --- | --- |
| `node scripts/check_stability.js` | exit 0, 27 PASS | Node, không ConPTY. Thêm legacy key, seal throw, file 600 KiB, UTF-8, BOM/CRLF, preview cắt, conflict |
| `node node_modules/electron/cli.js scripts/smoke_workbench.js` lần 1 | 1 FAIL textContent của textarea, rồi process exit `0xC0000005` | Electron + ConPTY + profile tạm |
| cùng lệnh lần 2, sau khi smoke đọc `value` và pty được gán null lúc exit | exit 0, all checks passed | cùng ranh giới |
| `node node_modules/electron/cli.js scripts/smoke_mobile.js` | exit 0 | HTTP/WS loopback + một powershell |
| `node node_modules/electron/cli.js scripts/lifecycle_cycles.js` | 20/20 PASS, exit 0, live 0 | ConPTY create/close, không soak |
| `node scripts/dev.js` với `AGENT_HUB_USER_DATA` tạm | Electron process xuất hiện, đã tắt | Không đụng profile mặc định |
| Soak ≥ 30 phút | NOT_RUN | |
| `npm run dist`, cài/gỡ sandbox | NOT_RUN | |
| CLI/provider/phone/VPN thật | NOT_RUN | |

Ảnh UI: không lưu. Không có secret trong log.

## 5. CLI và thiết bị

Mọi dòng CLI thật: Launch NOT_RUN, provider NOT_RUN, resume NOT_RUN. Mock/contract: bảng capability và catalog đã so trong `npm run check`. Terminal/powershell là tiến trình smoke, không phải hội thoại agent.

Phone thật và VPN: NOT_RUN. Desktop + client giả lập chỉ có smoke mobile một máy.

## 6. Artifact

Chưa đóng gói. Không có exe mới, không upload. Khi build, `scripts/build_app.mjs` ghi `app/BUILD.json` và `dist/BUILD.json` với version, commit, sha256, `signing: unsigned`, `platform: win32-x64`.

## 7. Cho Codex

- Review: `git diff 94257b12aabe4dcb2ec48e1c2c6a74a37c71e1fa...HEAD`
- Chạy lại: `npm run check`, rồi Electron `scripts/smoke_workbench.js`, `scripts/smoke_mobile.js`, `scripts/lifecycle_cycles.js`. Đặt `AGENT_HUB_USER_DATA` nếu tự mở app.
- Public release: NOT_READY. Thiếu chữ ký, máy sạch, soak, CLI thật, auto-update.
- Local review: sẵn sàng đọc code và bằng chứng. Không phải APPROVED_FOR_PUSH.

## 8. Dành cho Codex

- CODEX_REVIEW_STATE: CHANGES_REQUESTED
- HEAD đã review: `4edad8c880b1f0d23f0f15b2bb77fd0c42172b37`, ngày 03/11/2026.
- Quyết định: chưa đạt điều kiện push/tạo PR. Người dùng đã cho phép Codex push/tạo PR nếu review đạt; hiện còn sáu regression đã tái hiện độc lập, gồm ba lỗi P1 mất dữ liệu.
- Báo cáo reviewer, ma trận T01–T28/subtask và prompt sửa tiếp cho Grok: [codex-review.md](docs/handoffs/stabilization/codex-review.md).
- `npm run check`, workbench/mobile smoke, 20 lifecycle cycles và JS syntax đều pass. Fixture `scripts/codex_review_regressions.js` exit 1: R1–R6 FAIL; evidence ở `docs/handoffs/stabilization/evidence/codex-review-regressions.json`.
- Không sửa implementation, không commit/push/PR/merge/release trong lượt review. Chỉ bổ sung hồ sơ review và fixture kiểm chứng. Không có kênh gửi trực tiếp Grok; prompt bàn giao nằm trong báo cáo trên.

## 9. Sửa sau review

- Implementation: `53a24d5d29bd65d3a34bb43e420bc2e210931b92` trên `fix/workbench-stability`.
- R1: file trong giới hạn 4 MiB được đọc hết trước khi sửa. File lớn hơn không có editor. `write_text` từ chối khi bản đã nạp ngắn hơn file hiện tại và mtime không đổi.
- R2: buffer bẩn/conflict nằm trên từng file. Activate không đọc đè buffer đó. Save giữ generation để response cũ không đánh dấu bản gõ sau là saved.
- R3: `write_stored` không chạy khi còn `pending_plain`. Đổi metadata, xóa provider khác, hoặc seal throw đều để nguyên file.
- R4: record id được giữ khi restore. Layout chỉ ghi sau khi pane đã gắn và tree đã áp lại. Fixture cùng process đo 653.7/276.7, ratio 0.7026.
- R5: mọi `set_active_pane` đồng bộ explorer. File tab không đổi root. Quick-open hỏi root tại thời điểm sự kiện.
- R6: process exit không xóa saved record. Restart dùng record đó, `use_worktree:false`, không nhận worktree do renderer bịa.
- Evidence FAIL gốc giữ nguyên: `docs/handoffs/stabilization/evidence/codex-review-regressions.json`.
- Lượt pass sau sửa: `docs/handoffs/stabilization/evidence/codex-review-regressions-4edad8c-1793704241034.json`. R1–R6 PASS, exit 0. R2 `statusBeforeSwitch` là `conflict`.
- Lượt giữa, trước khi đưa kiểm tra mtime lên trước: `codex-review-regressions-4edad8c-1793704056937.json`. R1–R6 vẫn PASS nhưng R2 báo `error` vì file đĩa dài hơn bản đã nạp. Không dùng file đó làm kết quả cuối.
- Vẫn NOT_RUN: đóng/mở app thật 2/4/6 pane, reload sau restart, worktree bẩn, `src/foo.js` trên hai worktree, soak, dist/cài/gỡ, CLI/provider/phone/LAN/VPN, safeStorage thật, máy sạch, chữ ký.
- Public release: NOT_READY. Chưa push, chưa merge, chưa phát hành.
