# AgentSense — nhiệm vụ chi tiết T01–T28

Ngày giao: 03/11/2026. Baseline audit: `94257b12aabe4dcb2ec48e1c2c6a74a37c71e1fa`.
Repo tham chiếu: `quanw12/AgentSense`. Branch local đề xuất: `fix/workbench-stability`.
Người thực hiện: Grok 4.7. Gate cuối: Codex review. **Chưa được push/merge/publish.**

## 0. Quy tắc nghiệm thu

- Đọc `grok-4.7-prompt.md` và `stabilization-plan.md` trước khi làm.
- T01–T28 ánh xạ 1:1 với 28 phát hiện trong `docs/handoffs/stabilization/audit.md`.
- Vị trí code dưới đây là điểm bắt đầu tìm kiếm; xác minh lại ở HEAD đang làm, không sửa theo số dòng cứng.
- Mỗi mục cần: nguyên nhân; thay đổi; kiểm tra trước/sau; đường dẫn log/ảnh; trạng thái; phần chưa đạt.
- Chỉ dùng FIXED_VERIFIED khi toàn bộ tiêu chí đã được kiểm chứng. Không coi NOT_RUN/BLOCKED là PASS.
- Test bản source và bản đóng gói là hai việc khác nhau. Reload renderer và thoát/mở lại app cũng là hai việc khác nhau.
- Không tác động dữ liệu/profile/agent thật; fixture phải có root tạm được kiểm tra trước khi dọn.
- Mỗi lần chạy app/dev/exe để test dùng `AGENT_HUB_USER_DATA` riêng trong tiến trình con; không dùng profile mặc định.
- Khi làm việc dài, cập nhật `stabilization-results.md`. Có thể chia commit local theo giai đoạn,
  nhưng không được bỏ mục hoặc tự thu nhỏ yêu cầu.

## Giai đoạn A — pane cố định

### T01 — Chọn agent chỉ đổi focus [P1]

**Vấn đề:** Tabs và zoom dùng FULL_RECT cho pane được chọn, ẩn các pane khác; trái nhu cầu xem đồng thời.
**Code bắt đầu:** `src/renderer/terminal_grid.js`: place_pane, select_tab, toggle_zoom, focus_session_in_grid;
`src/renderer/sidebar.js`; `src/renderer/terminal_grid.css`.

- [ ] Tách selected/focused pane khỏi layout/geometry. Bấm thân terminal, tab, sidebar và Ctrl+Tab chỉ đổi focus.
- [ ] Bỏ fullscreen-switch và double-click maximize khỏi luồng mặc định; không cho thao tác chọn bật lại zoom cũ.
- [ ] Di trú `agentsense.workbench` có mode=tabs/zoom về chế độ fixed split an toàn; không xóa workspace/session của người dùng.
- [ ] Không dùng scrollIntoView làm cuộn cả workbench hoặc giật màn hình khi pane đã nhìn thấy.
- [ ] Giữ khả năng kéo divider, clipboard, nhập liệu, keyboard navigation và resize PTY.

**Nghiệm thu:** với 2/4/6 pane, click và chuyển focus ít nhất 20 lần qua các đường điều hướng;
bounds của mọi pane không đổi quá 1 CSS px, số pane đang hiện không giảm; không tạo lại PTY hoặc gửi phím
điều hướng vào shell. Chọn agent trong workspace khác chỉ chuyển đúng workspace, giữ bố cục đã lưu của nó.
Double-click header cũng không làm terminal chiếm toàn vùng. Chạy case có legacy mode=tabs từ profile fixture.

### T02 — Lưu bố cục theo workspace [P1, phụ thuộc T01]

**Code:** terminal_grid.js: save_ui, create_view, start_divider_drag; storage/session identity.

- [ ] Lưu split tree, tỷ lệ, slot/order, logical session identity, vùng file và tab/file đang mở; không dựa vào pane_serial hay PID dễ đổi.
- [ ] Restore sau renderer reload và app relaunch; dữ liệu cũ/corrupt/missing file phải fallback rõ ràng, không phá phiên khác.
- [ ] Khi cửa sổ nhỏ hơn, áp dụng min size/adaptive layout mà không làm mất tỷ lệ người dùng đã lưu.

**Nghiệm thu:** bố cục 70/30 và split lồng nhau giữ tỷ lệ sau reload, đóng/mở app, đổi workspace;
file tab còn tồn tại được phục hồi, file mất có phản hồi; terminal ID/geometry không bị gán nhầm.
Hai workspace có cấu hình khác nhau không ghi đè nhau. Không lưu API key trong state UI.

### T03 — Một vùng file có nhiều tab; không chia pane vô hạn [P1, phụ thuộc T01–T02]

**Code:** terminal_grid.js: mount_file_pane, open_file_in_grid, insert_into_layout; file_panel.js.

- [ ] File đầu mở/reveal vùng file theo vị trí/size đã lưu; các file tiếp theo thành tab trong cùng vùng.
- [ ] Chuyển file/đóng tab không thay geometry terminal; click lại file dùng lại tab, không tạo bản sao.
- [ ] Áp dụng kích thước tối thiểu thực tế và xử lý cửa sổ hẹp; không có pane chỉ cao vài px.

**Nghiệm thu:** mở 20 file xen kẽ text/image/PDF; số vùng split không tăng theo số file;
terminal giữ nguyên sau khi vùng file đã mở. Không có pane dưới min size đã công bố; đóng tab/vùng file
và reload không phá terminal hoặc mất tỷ lệ. Có kiểm tra bounds/overlap và ảnh app thật.

### T04 — Tách cấu hình từng workspace [P2, phụ thuộc T01–T02]

- [ ] Bỏ một biến mode/layout chung áp cho mọi view; giữ preferences thực sự toàn app riêng với layout theo workspace.
- [ ] Files panel tiếp tục bên phải; visibility/width/active context được định nghĩa và lưu nhất quán.

**Nghiệm thu:** thay divider/panel ở workspace A không đổi B; chuyển A→B→A và relaunch vẫn đúng.
Nếu mode Tabs cũ bị loại bỏ theo T01, không tái tạo nó chỉ để giữ UI cũ.

## Giai đoạn B — phiên, model, worktree

### T05 — Giữ model/provider khi restart/restore [P1, phối hợp T18]

**Code:** `src/main/session_store.js`, `pty_manager.js`, `ipc_terminals.js`, launch_page.js, terminal_grid.js.

- [ ] Lưu model selection/provider ID và các tùy chọn có kiểu rõ ràng; main process resolve env/args khi launch/restart/restore.
- [ ] Không sửa bằng cách ghi toàn bộ env_extra/API key vào sessions.json, preset, localStorage hoặc log.
- [ ] Migration record cũ giữ nguyên default; provider bị xóa/không giải mã được phải báo cần hành động, không âm thầm chuyển provider/model.

**Nghiệm thu:** mock CLI ghi ra đúng model/endpoint không nhạy cảm sau launch, Restart, renderer reload,
app relaunch và preset; fixture token không xuất hiện dạng thuần trong mọi file state/log/artifact.
Kiểm tra không rò env giữa hai pane khác provider; real-provider test ghi riêng, thiếu tài khoản ghi NOT_RUN.

### T06 — Bảo toàn ownership worktree khi reattach/restart [P1]

**Code:** pty_manager.js: to_info/close_terminal; terminal_grid.js: attach_info_to_view/restore_spec/restart_pane;
`src/main/worktree.js`.

- [ ] Trả/giữ đầy đủ base_cwd, worktree path, repo, branch và ownership trong các hợp đồng cần thiết.
- [ ] Restart giữ ngữ cảnh worktree hiện tại khi hợp lệ; tách restart process khỏi thao tác destroy session/worktree.
- [ ] Không xóa thư mục mà tiến trình mới sắp dùng; không tự tạo branch mới thay thế ngữ cảnh cũ khi chỉ Restart.
- [ ] Không force-remove worktree có changes, untracked file hoặc commit riêng.

**Nghiệm thu:** clean/dirty/committed worktree, renderer reload rồi process exit/Restart, app relaunch và
phone-created session đều giữ đúng cwd/branch/context. Case audit `cwd does not exist` không còn xuất hiện.
Đóng chủ động một worktree sạch vẫn có cleanup an toàn; worktree bẩn/committed được giữ và thông báo đúng.

### T07 — Giữ phiên restore thất bại để retry [P1]

**Code:** terminal_grid.js: restore_saved_in_grid; `src/main/ipc_sessions.js`.

- [ ] Không gọi discard chỉ vì spawn/restore lỗi tạm thời. Giữ metadata và lý do lỗi.
- [ ] Có Retry, chọn lại thư mục phù hợp và Forget chủ động; chỉ Forget mới bỏ record theo hành động rõ ràng.
- [ ] Lỗi một phiên không chặn các phiên còn lại hoặc làm mất model/provider/worktree của phiên lỗi.

**Nghiệm thu:** folder tạm không tồn tại/quyền từ chối/CLI thiếu rồi có lại; record vẫn còn và Retry chạy được.
App relaunch vẫn hiển thị được lỗi/khả năng phục hồi. Không tự tạo hội thoại khác thay cho phiên đã lưu.

### T08 — Resume theo khả năng từng CLI [P2, phụ thuộc T05–T07 và T12]

- [ ] Khai báo capability resume/restart/new-session và version hỗ trợ cho từng agent.
- [ ] Agent có session ID/cơ chế resume chính thức: dùng adapter phù hợp, test args/session identity.
- [ ] Agent không hỗ trợ hoặc chưa xác minh: ghi rõ chỉ khôi phục terminal/command; không hiển thị là tiếp tục hội thoại.
- [ ] Claude session ID không tồn tại: giữ thông tin, giải thích và cho người dùng chủ động mở phiên mới.

**Nghiệm thu:** resume ID hợp lệ, ID mất, CLI version không hỗ trợ; không silent fallback sang hội thoại mới.
Mock contract tests và kiểm tra hội thoại thật được ghi riêng. Không bịa resume flag.

### T09 — Preset giữ cấu hình đầy đủ [P2, phụ thuộc T02/T05/T18]

- [ ] Schema preset có slots/agent/model/provider reference/worktree choice và bố cục phù hợp.
- [ ] Migration preset cũ chỉ có agent IDs, agent/provider thiếu và tên preset trùng được xử lý rõ ràng.
- [ ] CLI tùy chọn được giữ khi hỗ trợ lưu preset; không làm mất command/label mà vẫn báo lưu thành công.

**Nghiệm thu:** save/load/relaunch lineup hỗn hợp và custom CLI tái tạo đúng cấu hình; không chứa secret;
một agent thiếu không làm gán nhầm model/provider sang slot khác.

### T10 — Cây file/preview theo đúng worktree [P2, phụ thuộc T06]

- [ ] Có root/context rõ ràng: workspace gốc hay worktree của agent đang chọn; tên/branch/path cho người dùng nhận biết.
- [ ] Đổi focus có thể đổi context file nhưng không đổi geometry terminal; tab file giữ root identity riêng.
- [ ] Không gộp hai file trùng relative path ở hai worktree thành một tab sai nội dung.

**Nghiệm thu:** repo gốc và hai worktree có `src/foo.js` với ba nội dung khác nhau; cây file, preview/editor,
Open/Reveal và file tab luôn trỏ đúng root. Root bị dọn phải hiển thị trạng thái mất nguồn, không đọc nhầm root khác.

### T11 — Kéo file đúng ngữ cảnh và đường dẫn [P2, phụ thuộc T06/T10/T19]

- [ ] Payload file có root/file identity; target xác định bằng session ID và cwd thực tế, không phải pane đang focus ngẫu nhiên.
- [ ] File repo/worktree có đường dẫn tương ứng: ánh xạ sang đúng file trong target worktree, giữ cấu trúc `src/foo.js`.
- [ ] Nếu bản nguồn khác hoặc target chưa có, không âm thầm overwrite hay tạo `foo (1)` ở gốc;
  có hành vi rõ ràng cho việc tham chiếu file nguồn hoặc import attachment. External drop dùng staging có collision handling.
- [ ] Dán bằng bracketed paste khi CLI hỗ trợ; không Enter, không tự chạy prompt/lệnh. Báo lỗi target đã exit/close trong lúc copy.

**Nghiệm thu:** tree/tab/Explorer drops; file có dấu, khoảng trắng, dấu nháy, nhiều file và hai root;
target worktree đúng file/nội dung. Chỉ target nhận input; không newline-submit; không overwrite dữ liệu đang sửa.
Test target đóng trong lúc import, retry không tạo bản copy vô hạn, lỗi từng file được báo đầy đủ.

### T12 — Capability/compatibility matrix CLI [P2]

**Code:** agents.js, launch_page.js, command_check.js và launch path ở main/mobile.

- [ ] Lập bảng đủ 14 lựa chọn hiện có + custom: executable, version/prerequisites, launch, model, provider,
  resume và tình trạng hỗ trợ thực tế; mỗi adapter dùng help/tài liệu chính thức làm nguồn.
- [ ] Chặn cấu hình provider/model không tương thích; không giả định mọi CLI nhận `<AGENT>_MODEL` hoặc OPENAI_*.
- [ ] Phân biệt installed, prerequisite missing, auth needed, unsupported capability, unverified và ready.
- [ ] Shared catalog/capabilities giữa desktop/mobile không bị lệch.

**Nghiệm thu:** contract tests cho từng mapping, executable thiếu/CLI version cũ/config không hợp lệ;
ma trận ghi rõ CLI thật đã launch, provider thật đã chat hay chỉ mock. Không coi 14 card là 14 agent đã xác thực.

## Giai đoạn C — file và hiệu năng

### T13 — Preview/editor không hiện nội dung cũ [P1, phối hợp T28a]

- [ ] Bấm mở lại tab kiểm tra thay đổi trên đĩa; tự cập nhật preview khi file đổi.
- [ ] Editor có buffer chưa lưu: phát hiện external change/conflict, không tự ghi đè hay mất buffer.
- [ ] Xử lý rename/delete/file quá lớn, selection/scroll và race response cũ về sau response mới.

**Nghiệm thu:** thay file bằng agent giả lập, mở lại/đổi tab; nội dung mới xuất hiện.
External edit + unsaved edit được giữ đủ dữ liệu để xử lý conflict; đọc chậm không hiển thị kết quả của root/tab cũ.

### T14 — Đồng bộ cây file [P2, phụ thuộc T10]

- [ ] Watch/invalidate theo root bằng cơ chế có debounce/batching và dispose; loại trừ vòng lặp/node_modules/.git nặng theo chính sách rõ ràng.
- [ ] Theo dõi create/modify/rename/delete từ agent hoặc ứng dụng ngoài; root đổi/mất không rò watcher.

**Nghiệm thu:** các event file xuất hiện đúng sau debounce, đổi workspace/root lặp lại không nhân watcher;
burst nhiều file không render storm và input/output terminal tiếp tục hoạt động.

### T15 — Refresh giữ ngữ cảnh duyệt file [P2, phụ thuộc T14]

- [ ] Giữ expanded folders, selection, scroll và keyboard focus khi refresh/import/watch update.
- [ ] File/folder biến mất được loại đúng, không để cache mồ côi hoặc collapse cả cây.

**Nghiệm thu:** mở ba tầng thư mục rồi refresh/import và rename/delete một nhánh;
các nhánh còn lại giữ trạng thái, đúng selection và không nhảy scroll về đầu.

### T16 — Import không bỏ mục âm thầm [P2]

- [ ] Không slice quá giới hạn rồi trả thành công một phần như toàn bộ đã được xử lý.
- [ ] Chọn reject toàn batch trước khi copy hoặc chia batch có progress; mọi mục phải có kết quả/explicit rejection.
- [ ] Collision, file lỗi và cancel được ghi rõ; copy thành công một phần được giữ nhất quán.

**Nghiệm thu:** 0/1/100/101/250 mục; tổng accepted+failed+skipped+cancelled bằng tổng yêu cầu;
UI và backend thống nhất số lượng, không overwrite file trùng.

### T17 — IO file nặng không chặn main; có progress/cancel [P2]

- [ ] Chuyển tác vụ list/read/copy nặng sang async/worker có concurrency/backpressure phù hợp.
- [ ] Progress/cancel/cleanup cho import; giới hạn size/khối lượng hợp lý, không đọc toàn file lớn chỉ để xác định preview.
- [ ] Không dọn file cũ/ngoài root khi cancel; file tạm có ownership rõ ràng.

**Nghiệm thu:** fixture nhiều file và file lớn có kích thước/thời lượng được ghi lại;
terminal vẫn nhận input/output, IPC/mobile không bị treo, cancel dừng tác vụ và không để orphan task.
Đo thời gian phản hồi/event-loop thay vì chỉ nói cảm giác mượt.

## Giai đoạn D — dữ liệu, ranh giới file, mobile

### T18 — Bảo vệ API key [P1 trước public release, phụ thuộc T05 migration]

- [ ] Dùng kho bí mật OS/Electron safeStorage với kiểm tra availability/backend; không fallback lưu thuần khi encryption không dùng được.
- [ ] State/preset/session/UI chỉ giữ reference và metadata; renderer không nhận lại API key đầy đủ qua list sau khi lưu.
- [ ] Migration providers.json cũ an toàn, atomic, có recovery phù hợp; không tạo backup/log mới chứa plaintext.
- [ ] Lỗi decrypt/migration được hiển thị có thể xử lý; không tự xóa credential hay dùng sai provider.

**Nghiệm thu:** fixture token không xuất hiện thuần trong JSON/log/screenshot/artifact; thử unavailable/decrypt failure,
migration bị ngắt, remove/update provider và relaunch. Dùng fake credential, không đọc key profile thật.

### T19 — Chặn junction/symlink thoát root [P2]

- [ ] Xác minh canonical/real path của root và target; file và directory traversal phải áp dụng cùng hợp đồng.
- [ ] Kiểm tra root do main xác định, path traversal, sibling prefix, Windows drive/UNC và liên kết ngoài root.
- [ ] External import là operation riêng với nguồn do người dùng chọn; không làm hỏng drag-drop ngoài workspace hợp lệ.
- [ ] Không trả file URL/Open/Reveal/convert document cho target ngoài allowed root qua liên kết.
- [ ] Editor/save mới ở T28a áp dụng cùng boundary cho file và parent directory, không tạo đường ghi ra ngoài qua junction.

**Nghiệm thu:** test junction/symlink ngoài root của audit bị từ chối; symlink trong root hoạt động theo chính sách;
list/read/preview/document/Open/Reveal/import không lách boundary. Các root workspace/worktree hợp lệ vẫn dùng được.

### T20 — Một chủ sở hữu kích thước PTY [P2]

- [ ] Định nghĩa size owner desktop khi pane đang hiển thị; phone được takeover khi thích hợp bằng chính sách rõ ràng.
- [ ] Gửi/đồng bộ terminal dimensions cho viewer còn lại; tránh resize ping-pong, resize vào PTY đã chết và làm thay layout chỉ vì đổi focus.

**Nghiệm thu:** desktop + ít nhất hai WebSocket clients có viewport khác nhau;
attach/detach/background/rotate/reconnect không làm size dao động. Test integration mô phỏng và hai thiết bị thật ghi riêng.

### T21 — Rate limit không khóa chung người dùng hợp lệ [P2]

- [ ] Giới hạn theo nguồn/kết nối với cleanup/bounds; lỗi token từ nguồn A không khóa nguồn B có token đúng.
- [ ] Chỉ tin proxy headers khi có proxy được cấu hình rõ; giữ timing-safe token check, token rotation và kiểm tra mọi request/upgrade.
- [ ] Tránh cấu trúc rate-limit tăng bộ nhớ vô hạn hoặc cho qua brute-force vì thay header.

**Nghiệm thu:** nguồn A nhiều token sai, nguồn B hợp lệ vẫn HTTP/WS được;
A vẫn bị hạn chế; token cũ sau rotate bị từ chối; expiry/cleanup và giới hạn nguồn được test.

### T22 — Phạm vi mobile LAN/VPN rõ ràng [giới hạn vận hành]

- [ ] Giữ default an toàn và công bố đúng phạm vi LAN/VPN; UI phân biệt loopback với lắng nghe LAN.
- [ ] Không tuyên bố đã có remote internet/TLS/identity nếu chưa làm. Tránh log token URL, thêm no-store/no-referrer phù hợp.
- [ ] Kiểm tra auth cho static/WS, bind changes, token rotation, reconnect và tắt server; không mở port router/firewall hay đổi OS settings hộ người dùng.

**Nghiệm thu:** topology test chỉ rõ kết nối nào truy cập được, token sai/thiếu không đọc/điều khiển terminal;
tắt server hủy kết nối và không còn listener. Ghi LAN/VPN verified hay NOT_RUN; không cần triển khai dịch vụ cloud trong nhiệm vụ này.

## Giai đoạn E — lifecycle và nguồn phát hành

### T23 — Điều tra timeout/ConPTY teardown [P1]

- [ ] Instrument từng bước create/exit/kill/reload/cleanup; tái hiện timeout sau 25 checks, xác định test hay sản phẩm/native.
- [ ] Chờ lifecycle đúng thứ tự, cancellation/race-safe, không resize/write vào session đang đóng; cleanup idempotent.
- [ ] Không sửa bằng tăng timeout vô hạn, suppress AttachConsole error hoặc kill toàn bộ electron/node của máy.
- [ ] Child helper, hooks, socket, timer, watcher và worktree phải được dispose theo ownership.

**Nghiệm thu:** tối thiểu 20 chu kỳ mở/đóng/restart/reload với nhiều pane và một lượt soak ít nhất 30 phút;
ghi resource/process count trước/sau, tất cả test processes thoát trong deadline đã công bố.
Native Windows test bắt buộc để đánh dấu FIXED_VERIFIED; mock không thay thế được. Không còn timeout/exception không giải thích.

### T24 — Một nguồn build, không phân phối payload cũ [P1 trước phát hành]

**Code:** `package.json`, `scripts/build_app.mjs`, installer và script package mới nếu cần.

- [ ] Một lệnh điều phối build mới → verify source/version/hash → stage payload → package local.
- [ ] Không lấy app/ cũ chỉ vì AgentSense.exe tồn tại; thêm build provenance/manifest gắn commit và version.
- [ ] Package loại trừ profile/token/log riêng tư, node_modules dev ngoài nhu cầu và fixture/audit runtime.

**Nghiệm thu:** tạo stale app/ cố ý rồi chạy pipeline; artifact ra đúng build mới hoặc fail rõ;
source/dist/payload/manifest khớp phiên bản và file quan trọng. Không upload artifact lên remote.

### T25 — Nâng cấp/đóng gói có rollback [P2 trước stable]

- [ ] Stage + verify bản mới trước khi thay bản đang chạy; backup/swap/restore có giới hạn ownership.
- [ ] Từ chối khi app đang chạy; mọi recursive delete/move xác minh absolute path trong install/staging root.
- [ ] Không chạm dữ liệu `%APPDATA%\\AgentSense`; rollback binary và schema/data compatibility được nêu rõ.

**Nghiệm thu:** cài mới, A→B upgrade, uninstall; inject lỗi giữa copy, thiếu dung lượng/quyền/lỗi verify;
bản cũ còn chạy hoặc rollback được, dữ liệu mẫu nguyên vẹn. Chỉ thử trong install/shortcut/profile tạm.

### T26 — Hạ tầng version/phát hành; chỉ chuẩn bị local [đánh giá từng mục con]

- [ ] **T26a Version/provenance:** xác định quy tắc prerelease/stable, hiển thị version/build trong UI, CHANGELOG và manifest/hash local.
- [ ] **T26b CI:** chuẩn bị workflow lint/check/regression/native Windows/build/artifact validation; kiểm tra YAML/script local.
  Chưa chạy remote thì ghi REMOTE_CI=NOT_RUN; không push để thử workflow.
  CI kiểm tra dùng quyền tối thiểu; không thêm publish-on-push hay cơ chế tự push/merge/release bỏ qua gate review.
- [ ] **T26c Download/release:** soạn release notes, checksum, tên artifact và hướng dẫn tải/cài/nâng cấp/gỡ.
  Repo hiện private: ghi phương án phân phối chờ chủ repo quyết định; không đổi visibility hay tạo release.
- [ ] **T26d Signing:** chuẩn bị tích hợp signing có kiểm tra kết quả; không bịa cert/chữ ký.
  Thiếu certificate/secrets: ghi SIGNING=BLOCKED, không ghi exe đã ký.
- [ ] **T26e Updates:** chuẩn bị thiết kế/code cập nhật có kiểm tra integrity/signature và rollback,
  hoặc giữ manual update được công bố rõ cho beta. Automatic update production chưa test thì để NOT_RUN/BLOCKED,
  không coi tài liệu manual là đã triển khai auto-updater.
- [ ] **T26f Platform:** chỉ công bố Windows x64 khi đã kiểm tra; macOS/Linux không nằm trong lời hứa hỗ trợ của lượt này.

**Nghiệm thu:** mọi mục con có trạng thái riêng và bằng chứng. Không cho T26=FIXED_VERIFIED nếu một yêu cầu bắt buộc
vẫn bị chặn. Mục có thể hoàn thành bằng xác lập phạm vi phải ghi APPROACH/SCOPE riêng, không đổi tên thiếu tính năng thành PASS.

### T27 — Sửa dev script trên Windows [P3]

- [ ] Dùng runner/env cross-platform phù hợp; giữ devtools chỉ bật ở dev, không rò vào packaged production.

**Nghiệm thu:** npm run dev khởi động trên Windows, npm start và packaged exe vẫn bình thường;
test không cần mở shell/cửa sổ không liên quan hoặc tác động app/profile đang dùng.

### T28 — Editor/quick-open và lấp khoảng trống kiểm chứng [đánh giá từng mục con]

- [ ] **T28a Editor/autosave:** text editor trong vùng file chung, file tab đúng root, debounce autosave và trạng thái saved/saving/error.
  Dùng revision/conflict check; không overwrite external changes khi có buffer bẩn; giữ undo/buffer khi lỗi.
  Giữ line endings/encoding được hỗ trợ, không tự format toàn file hoặc làm mất ký tự/BOM mà không thông báo.
  Binary/large/read-only file tiếp tục preview hoặc báo rõ. Không mặc định thêm framework lớn nếu giải pháp hiện có đủ.
- [ ] **T28b Quick-open:** Ctrl+P tìm file theo root/context, gồm dotfiles; có giới hạn/ignore policy,
  keyboard navigation và cancel; không scan toàn ổ đĩa hoặc chặn main process.
- [ ] **T28c Acceptance tests:** bỏ expectation Tabs/zoom ẩn pane là đúng; thêm focus-only bounds tests,
  layout persistence, file-group tabs, conflict-safe save và các regression T01–T27.
- [ ] **T28d Clean-machine/install:** bản đóng gói trên Windows sạch/tài khoản thường, thiếu Git/CLI/Node khi phù hợp,
  path khoảng trắng/tiếng Việt, upgrade giữa hai artifact version thực tế và rollback.
- [ ] **T28e Real integrations:** ma trận CLI + auth/provider thật, LAN/VPN/phone, sleep/wake,
  mất/đổi mạng, crash/recovery và multi-agent soak. Không có môi trường thì ghi NOT_RUN/BLOCKED và cách chủ repo kiểm tra.

**Nghiệm thu:** test UI thật và dữ liệu fixture cho editor/conflict/quick-open; native/physical/real-provider
tests có ngày, phiên bản, môi trường, thời lượng và kết quả. Từng mục con có trạng thái; thiếu kiểm chứng không được tự tick hoàn tất.

## Giai đoạn F — bàn giao để Codex review

- [ ] Mỗi T01–T28 và từng T26/T28 subtask có code/evidence/status; không còn hàng trống hoặc nhãn “done” không có test.
- [ ] Chạy các script còn áp dụng: `npm run smoke:workbench`, `npm run smoke:mobile`, syntax/lint/check mới,
  `npm run dev`, build/package local và install/upgrade/uninstall sandbox. Ghi rõ script bị thay thế và lý do.
- [ ] Git diff không chứa secret, fixture cá nhân, dist/app binaries hoặc audit output lớn; giữ lockfile nếu dependencies thay đổi.
- [ ] Báo cáo branch/base/head/local commits, tóm tắt thay đổi, known issues, test log/ảnh và bước tái hiện cho reviewer.
- [ ] Ghi `HANDOFF_STATE=READY_FOR_CODEX_REVIEW`; trạng thái public release đánh giá riêng, không tự đặt APPROVED.
- [ ] Không push, không merge, không PR/tag/release/deploy. Dừng chờ reviewer.
