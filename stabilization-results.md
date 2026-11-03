# AgentSense — kết quả thực hiện và bàn giao review

Người thực hiện: Grok 4.7 và Codex. Lịch sử review và quyết định remote mới nhất ở mục 8; các mục cũ giữ nguyên bằng chứng tại thời điểm thực hiện.

## 1. Metadata

- HANDOFF_STATE: READY_FOR_CODEX_REVIEW
- IMPLEMENTATION_STATUS: PARTIAL
- PUBLIC_RELEASE_READINESS: NOT_READY
- CODEX_REVIEW_STATE: VERIFIED_FOR_PR
- Ngày: 2026-11-03
- Repo root: `C:\StudyBase\AgentSense`
- OS / CPU: Windows 10.0.26300, x64. Node v24.11.1, npm 11.6.3, Electron 44.9.0
- Branch local: `fix/workbench-stability`
- Local commits: `03dda35`, `78f9e35`, `0260de4`, `4edad8c`, `53a24d5`, `c0c5e37`, `e6e3d86`, `28102e3`, `b03fed0`, `34b7ce3`, `cbc555d`, `521e51c`, `146576b`
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
| T13 | Editor không giữ nội dung cũ | IMPLEMENTED_NOT_VERIFIED | R1/R2/R7/R8 PASS. R9: quit khi đã conflict bị chặn, buffer còn `UNSAVED BUFFER TO KEEP`, đĩa giữ bản external | Chưa relaunch app để đọc lại file. Discard là nút riêng, không phải đóng banner |
| T14 | Watch cây file | IMPLEMENTED_NOT_VERIFIED | `files:watch` debounce, bỏ `node_modules`/`.git` | Chưa đo burst |
| T15 | Giữ expansion | IMPLEMENTED_NOT_VERIFIED | `refresh_preserve` giữ scroll/selection trong code | Chưa test 3 tầng |
| T16 | Import không cắt âm thầm | IMPLEMENTED_NOT_VERIFIED | check: 101 mục đều ok; 250 mục reject cả batch, không copy | Chưa đối chiếu số trên UI |
| T17 | IO không chặn main | IMPLEMENTED_NOT_VERIFIED | copy/list/search dùng fs.promises | Chưa đo event-loop |
| T18 | API key sealed | IMPLEMENTED_NOT_VERIFIED | R3: codec unavailable, đổi tên bị reject, file legacy giữ `api_key`. Node check: xóa provider khác và seal throw cũng không ghi đè file | safeStorage thật lỗi NOT_RUN. Không có fallback plaintext |
| T19 | Junction không thoát root | IMPLEMENTED_NOT_VERIFIED | check: junction ra ngoài bị `read_file` từ chối | Chưa symlink nằm trong root; chưa Open/Reveal |
| T20 | Một chủ PTY size | IMPLEMENTED_NOT_VERIFIED | Mobile resize không áp khi có cửa sổ desktop | Chưa 2 WebSocket và chưa máy thật |
| T21 | Rate limit theo nguồn | IMPLEMENTED_NOT_VERIFIED | check: A lock, B không. Smoke mobile: cùng nguồn vẫn lock sau 3 token sai | Chưa rotate token + expiry trên HTTP |
| T22 | Mobile LAN/VPN | IMPLEMENTED_NOT_VERIFIED | UI/state nói loopback và LAN, không nhận là internet/TLS. APPROACH: không làm cloud | LAN/VPN thật NOT_RUN |
| T23 | ConPTY lifecycle | IMPLEMENTED_NOT_VERIFIED | `146576b`: 4 workbench, 4 mobile, 4 harness `app.exit`, 4 product `app.quit` đều exit 0. 20 cycle, live 0. Không còn `0xC0000005` / `0xC0000409` trong bộ đó | Soak NOT_RUN. Chưa phải mọi cách đóng cửa sổ của người dùng |
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
| T28a | IMPLEMENTED_NOT_VERIFIED | R7–R10. Discard tăng `save_epoch` nên snapshot xếp hàng không được ghi | evidence discard-pending sau commit sửa | Chưa đo nhiều workspace cùng lúc trên UI |
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
- Trạng thái review/remote mới nhất xem mục 8 và `docs/handoffs/stabilization/codex-final.md`.

## 8. Dành cho Codex

- CODEX_REVIEW_STATE: VERIFIED_FOR_PR
- Commit runtime cuối: `332b6ed968cc9e2e91adb021ad035fba3dafede5`, ngày 03/11/2026. Commit hồ sơ/build theo sau không đổi runtime.
- Người dùng đã yêu cầu Codex tự sửa lỗi còn lại rồi commit/push, đồng thời giữ quyền tạo PR từ yêu cầu ban đầu. Quyết định: push branch và mở PR với giới hạn kiểm chứng công bố rõ; không merge hoặc phát hành.
- Báo cáo hiện tại: [codex-final.md](docs/handoffs/stabilization/codex-final.md). R1–R10, 12/12 native runs, concurrent exit/close, CLI resume mock, editor-format UI và sandbox installer đã pass. Nâng/pin upstream node-pty chứa mutex fix; full T01–T28 vẫn có PARTIAL/NOT_RUN, public release NOT_READY.
- Báo cáo reviewer, ma trận T01–T28/subtask và prompt sửa tiếp cho Grok: [codex-review.md](docs/handoffs/stabilization/codex-review.md).
- Evidence FAIL đầu tiên `codex-review-regressions.json` và các vòng trước được giữ nguyên lịch sử. Evidence xác nhận native cuối ở `docs/handoffs/stabilization/evidence/final-release-check/results.json`.

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

## 10. Codex review vòng 2

- HEAD `c0c5e37`: 27 Node checks, R1–R6, smoke workbench và 20 lifecycle cycles PASS. Evidence R1–R6 mới ở `docs/handoffs/stabilization/evidence/codex-review-regressions-c0c5e37-1793705137624.json`.
- Fixture mới `scripts/codex_review_editor_lifecycle.js`: control close/save PASS, R7 conflict khi close FAIL và R8 native app close trước autosave FAIL; exit 1. Evidence `docs/handoffs/stabilization/evidence/codex-review-editor-c0c5e37-1793705277414.json`.
- Mobile smoke có assertion PASS/exit 0 nhưng `AttachConsole failed` từ native helper, lặp lại cả khi chạy riêng. Log `docs/handoffs/stabilization/evidence/codex-review-mobile-c0c5e37.log`. Chưa xác định lỗi sản phẩm hay test/helper; cần điều tra, không coi teardown sạch.
- CHANGES_REQUESTED, không push/tạo PR/merge/release. Không sửa implementation hoặc tạo commit trong review này. Giao việc qua `codex-review-round2.md`.

## 11. Sửa sau review vòng 2

- Implementation: `e6e3d86ee10d3bd85ed81d5d3fb018a2b59c1cac`. Evidence dưới đây được ghi khi HEAD là commit đó. Commit hồ sơ sau nó không đổi runtime.
- R7: đóng tab await save. Conflict hoặc lỗi ghi giữ tab và buffer. Control đóng tab bẩn không có sửa ngoài vẫn ghi `SAVED ON CLOSE`.
- R8: `BrowserWindow` `close` bị giữ lại đến khi renderer flush xong. File vừa gõ được ghi trước sự kiện `closed`. Conflict phát sinh trong lần flush đó hủy close. Tab đã ở trạng thái conflict từ trước không bị ghi đè và không chặn quit.
- C1: nguyên nhân là `pty.kill()` trên ConPTY không-DLL. node-pty fork `conpty_console_list_agent.js`, helper gọi `AttachConsole` sau khi console đã bị hủy, rồi process smoke đã exit 0. Sửa ở sản phẩm: spawn Windows đặt `useConptyDll: true`, nên đường kill không tạo helper đó. Smoke mobile theo dõi helper nếu nó vẫn được fork và coi exit khác 0 là FAIL; stderr không bị nuốt. Log sạch: `docs/handoffs/stabilization/evidence/codex-review-mobile-e6e3d86.log` có `ALL CHECKS PASSED` và không có `AttachConsole`.
- R1–R6 chạy lại trên commit này: `docs/handoffs/stabilization/evidence/codex-review-regressions-e6e3d86-1793706200146.json`, exit 0.
- R7/R8: `docs/handoffs/stabilization/evidence/codex-review-editor-e6e3d86-1793706192197.json`, exit 0. Evidence FAIL gốc của vòng 2 giữ nguyên.
- Vẫn NOT_RUN: soak, dist/cài/gỡ, CLI/provider/phone/LAN/VPN, safeStorage thật, máy sạch, chữ ký, đóng/mở app 2/4/6 pane.
- Public release: NOT_READY. Chưa push, chưa merge, chưa phát hành.

## 12. Codex review vòng 3

- HEAD `28102e3`: 27 Node checks, R1–R8, smoke workbench/mobile và 20 lifecycle cycles PASS. Mobile smoke không còn native exception ở lượt này.
- **R9 [P1] FAIL:** file đã báo conflict bị `flush_dirty_editors` bỏ qua; native close được cho phép và mất buffer chưa lưu, không có user discard.
- Fixture `scripts/codex_review_conflicted_quit.js`; evidence `docs/handoffs/stabilization/evidence/codex-review-conflicted-quit-28102e3-1793706463362.json`; exit 1.
- Fixture R8 cũ chỉ kiểm B được lưu, chưa kiểm buffer conflict A khi quit; cần tách normal-close/known-conflict thành ca độc lập, không skip conflict để pass test cũ.
- CHANGES_REQUESTED. Không sửa implementation/commit/push/PR/merge/release trong review. Giao việc qua `docs/handoffs/stabilization/codex-review-round3.md`.

## 13. Sửa sau review vòng 3

- Quit không còn bỏ qua file `conflict`. Flush không ghi đè file ngoài. Nếu còn conflict, lỗi ghi, hoặc bản chưa lưu, cửa sổ ở lại và banner nêu tên file. Nút `Discard my edits` mới là discard chủ động; sau đó close tiếp theo được phép.
- R8 được tách khỏi conflict của R7: fixture bấm Discard, kiểm đĩa A vẫn là bản external, rồi mới đóng cửa sổ với B đang dirty.
- Implementation: `b03fed05e9c42adf2dc3311ff1504a4aaa5f4fd3`. Evidence ghi khi HEAD là commit đó.
- R9: `docs/handoffs/stabilization/evidence/codex-review-conflicted-quit-b03fed0-1793706961388.json`, cửa sổ không đóng, buffer còn nguyên. Evidence FAIL gốc của vòng 3 giữ nguyên.
- R7/R8 sau khi Discard rõ ràng: `docs/handoffs/stabilization/evidence/codex-review-editor-b03fed0-1793706965739.json`.
- R1–R6: `docs/handoffs/stabilization/evidence/codex-review-regressions-b03fed0-1793706974267.json`.
- Public release: NOT_READY. Chưa push, chưa merge, chưa phát hành.

## 14. Codex review vòng 4

- HEAD `34b7ce3`: known-conflict quit R9, explicit discard/normal close R7/R8, R1–R6, 27 Node checks và mobile smoke PASS. Lifecycle 20/20 PASS.
- R10 [P2] FAIL: Discard chưa invalidate queued save snapshot. Fixture slow-IO audit successful writes ghi nhận `OLD AUTOSAVE TWO` được ghi sau Discard trước khi autosave ghi trả external version; final contents đúng nhưng có overwrite tạm thời, không khẳng định mất dữ liệu vĩnh viễn trong ca này.
- `scripts/codex_review_discard_pending.js`, evidence `docs/handoffs/stabilization/evidence/codex-review-discard-pending-34b7ce3-1793707417778.json`, exit 1.
- Workbench smoke lần đầu timeout `test shells exit`; lượt xác nhận chạy riêng pass. Cần điều tra/ghi lifecycle tại timeout, không coi đã soak verified.
- CHANGES_REQUESTED. Không sửa implementation/commit/push/PR/merge/release trong review. Giao việc qua `docs/handoffs/stabilization/codex-review-round4.md`.

## 15. Sửa sau review vòng 4

- Discard tăng `save_epoch` và xóa timer. Task đã xếp hàng thấy epoch cũ thì không gọi write. Response của write đang chạy cũng bị bỏ nếu epoch đã đổi, nên không ghi đè buffer vừa nạp lại.
- Implementation: `cbc555df37e239a5a3933224e73f00276dc58706`.
- R10 trên commit đó: `docs/handoffs/stabilization/evidence/codex-review-discard-pending-cbc555d-1793707930795.json`. `writesAfterDiscard` rỗng, `writeCount` dừng ở 1, đĩa và editor vẫn là `EXTERNAL VERSION TO PRESERVE`. Evidence FAIL gốc của vòng 4 giữ nguyên.
- Workbench: lượt gộp chết `0xC0000005` sau khi các check UI đã pass, trước dòng "all checks passed". Lượt riêng sau đó exit 0. Bốn terminal còn `alive:true` ngay trước khi gửi `exit`. Không tăng timeout. Soak vẫn NOT_RUN.
- Public release: NOT_READY. Chưa push, chưa merge, chưa phát hành.

## 16. Codex review vòng 5

- HEAD `521e51c`: 27 Node checks, R1–R10 và 20 lifecycle cycles PASS. R10 không có write sau Discard (`writesAfterDiscard:[]`, writeCount 1).
- Native shutdown vẫn lỗi: workbench lượt 1/3 exit 0, lượt 2/4 exit -1073741819 (0xC0000005). Mobile in ALL CHECKS PASSED nhưng process exit -1073740791 (0xC0000409). Không gọi smoke sạch khi exit nonzero.
- Log/evidence `docs/handoffs/stabilization/evidence/codex-review-workbench-521e51c-*.log`, `codex-review-workbench-521e51c-runs.json`, `codex-review-mobile-521e51c.log`, `codex-review-mobile-521e51c-exit.json`.
- C2/T23 cần tách product/native/harness, xác định lifecycle ownership và completion, rồi có rerun không lỗi. Chưa xác định root cause hay khẳng định native close của sản phẩm luôn crash.
- CHANGES_REQUESTED; không sửa implementation/commit/push/PR/merge/release trong review. Giao việc chi tiết qua `docs/handoffs/stabilization/codex-review-round5.md`.

## 17. Sửa sau review vòng 5

- Implementation: `146576beaaa5e165ba43daf469605c2ffb08670a`.
- Nguyên nhân đã khóa bằng log: `node-pty` DLL `kill()` gọi `ClosePseudoConsole` trên HPCON đã `ConptyReleasePseudoConsole`, rồi `TerminateProcess(hShell)`. Watcher thoát đóng `hShell` và xóa baton trước khi vào JS. Workbench chết sau `pty native exit` và trước `pty socket exit` (`shutdown-wb-trace-2.log`, exit `-1073741819`). Đường quit sống cũng chết cùng mã trước khi worker dừng (`shutdown-control-quit-2.log`).
- Sửa: không gọi `proc.kill()`. Process còn sống thì `process.kill(pid)`. Callback native exit terminate conout worker ngay, rồi `kill_all` đợi promise đó. `will-quit` đợi `kill_all` rồi mới `app.quit()`. Workbench smoke `await kill_all()` rồi `app.exit`. `alive:false` không được dùng làm bằng chứng native đã xong.
- Nghiệm thu 4 lượt mỗi suite, không bỏ lượt lỗi, trên đúng nội dung đã commit (log ghi ngay trước `146576b`, không sửa code ở giữa): workbench exit 0/0/0/0 và "all checks passed"; mobile exit 0/0/0/0 và ALL CHECKS PASSED, không có AttachConsole; harness `app.exit` exit 0 và `orphans:[]`; product quit exit 0. Bảng `docs/handoffs/stabilization/evidence/c2-runs.json`.
- Sau commit, chạy lại: Node check 27 PASS; R1–R6, R7/R8, R9, R10 PASS (R10 `writesAfterDiscard:[]`, writeCount 1); lifecycle 20/20, live 0. Evidence `codex-review-regressions-146576b-1793710520529.json`, `codex-review-editor-146576b-1793710526404.json`, `codex-review-conflicted-quit-146576b-1793710530439.json`, `codex-review-discard-pending-146576b-1793710537268.json`, `c2-rerun-lifecycle.log`.
- Evidence FAIL/AV của vòng 5 và của các lượt điều tra giữ nguyên. Soak, máy sạch, CLI/provider/điện thoại thật vẫn NOT_RUN. Public release: NOT_READY. Chưa push, chưa merge, chưa phát hành.

## 18. Codex sửa cuối theo yêu cầu commit/push

- Runtime `332b6ed`: pin node-pty 1.2.0-beta.17 có mutex fix upstream; chặn launch khi shutdown, đợi accepted launch/native close, chia sẻ concurrent close promise; fallback saved Claude session ID. Editor giữ BOM/CRLF và chỉ đọc encoding/line ending chưa hỗ trợ.
- 27 checks, R1–R10, 20 lifecycle cycles, PTY/output/concurrent exit/child cleanup/admission, actual editor-format UI đều pass. Native suites cuối 12/12 exit 0, không orphan; production main.js quit được kiểm chứng trực tiếp.
- Build từ source + xác minh source/native hashes và dependency versions trước stage/swap. Installer checksum validation trước thay bản cũ. Sandbox install/reinstall/corrupt upgrade/uninstall pass; failed upgrade giữ exe cũ và sentinel không đổi.
- CI pull_request kiểm regression/native/build/install với quyền tối thiểu; remote CI chưa được tính PASS trước khi PR thực sự chạy.
- Chi tiết, evidence, failure lịch sử và giới hạn ở `docs/handoffs/stabilization/codex-final.md`. VERIFIED_FOR_PR theo scope đã chạy; public release vẫn NOT_READY, không tự đổi các requirement PARTIAL thành hoàn tất.
