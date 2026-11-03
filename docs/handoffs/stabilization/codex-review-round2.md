# Codex review vòng 2 — CHANGES_REQUESTED

Ngày 03/11/2026, Asia/Saigon. Branch `fix/workbench-stability`, HEAD kiểm tra `c0c5e371face5474490a1cf47f6114f98e6b45e3`. Diff implementation mới: `4edad8c..c0c5e37`, chủ yếu commit `53a24d5`.

**Cả R1–R6 cũ đã PASS khi Codex chạy lại độc lập. Tuy nhiên chưa đạt điều kiện push/PR vì còn hai lỗi mất bản sửa R7/R8 và lỗi native teardown C1 dưới đây.** Không push, PR, merge hay release trong vòng này. Không sửa implementation hoặc tạo commit; chỉ thêm fixture/evidence và cập nhật báo cáo.

## Những gì đã đạt

- R1: file 614400 byte được đọc đầy đủ, autosave ra 614404 byte sau thêm `EDIT`.
- R2: sau conflict → đổi tab → quay lại, vẫn giữ `MY UNSAVED EDIT`, trạng thái trước đổi tab là `conflict`.
- R3: metadata edit lúc codec unavailable bị reject và giữ fake legacy key. Node check còn kiểm remove provider khác và encrypt throw.
- R4: cold-restore fixture giữ ratio 0.70258 thay vì 50/50.
- R5: mousedown trong worktree terminal cập nhật explorer đúng root.
- R6: exit/Restart giữ worktree metadata trong main và sessions.json.

Evidence mới gắn đúng HEAD hiện tại: `evidence/codex-review-regressions-c0c5e37-1793705137624.json`. Evidence PASS của Grok trước commit có tên `4edad8c` nên không dùng làm bằng chứng HEAD mới; kết quả độc lập này xác nhận lại bản đã commit.

## R7 — [P1] Close tab xóa buffer trước khi async save phát hiện conflict

**Code:** `src/renderer/terminal_grid.js:1211–1229,1371–1392`. Liên quan T13/T28a, tiếp tục phần nghiệm thu close-before-debounce của R2.

`close_file_at` chỉ chặn nếu `file.conflict` đã được biết. Khi file còn dirty nhưng chưa hết 600ms debounce, nó gọi `flush_editor` theo kiểu fire-and-forget rồi splice/remove pane ngay. Save trả conflict sau đó nhưng tab/buffer đã bị loại khỏi UI. Banner vẫn nói “Your edits are still in the editor”, không đúng trạng thái thực tế.

**Tái hiện trên UI/IPC/file thật:** mở A → gõ `UNSAVED CONFLICT BUFFER` → sửa A từ bên ngoài thành `EXTERNAL CHANGE` → bấm đóng tab trước debounce → mở A lại. Tab không được giữ, editor chỉ hiện `EXTERNAL CHANGE`; bản sửa chưa lưu không có đường khôi phục trong UI. Control đóng tab dirty không có external change vẫn lưu thành công, nên đây là lỗi xử lý kết quả thất bại khi close.

**Yêu cầu Grok:** close phải await kết quả flush/save và chỉ remove tab khi lưu thành công hoặc người dùng chủ động discard. Conflict/write error phải giữ nguyên tab và buffer, với trạng thái đúng. Serialize hoặc quản lý save in-flight theo từng file; không để response cũ hoặc thao tác close chạy song song làm mất generation mới. Không coi việc gọi một hàm async là bằng chứng đã lưu.

**Nghiệm thu:** close trước debounce với save thành công/conflict/write error; close trong khi write đang chạy; file cuối/không phải file cuối; cả nút close file tab và titlebar. Kết quả lỗi không làm biến mất nội dung chưa lưu.

## R8 — [P1] Đóng cửa sổ app trước autosave làm mất nội dung vừa gõ

**Code:** `src/renderer/terminal_grid.js:1351–1378`; `main.js:138,188–195`. Liên quan T28a/T23.

Edit chỉ nằm trong RAM và được hẹn save sau 600ms. Native close không có handshake flush/bảo toàn dirty buffers; khi cửa sổ cuối đóng, app quit và renderer/timer bị hủy. `will-quit` hiện chỉ dừng mobile/PTY.

**Tái hiện:** mở B có `original B` → gõ `EDIT JUST BEFORE WINDOW CLOSE` → đóng native BrowserWindow qua đường close bình thường. Sau sự kiện `closed`, file vẫn là **original B**. Fixture không dùng `app.exit` để khởi tạo close; chỉ đặt exit code sau khi native close/quit đã diễn ra. Không có PTY hoặc dữ liệu user thật trong fixture này.

**Yêu cầu Grok:** native close/quit phải phối hợp renderer để flush tất cả dirty buffers và đợi write hoàn tất trước khi hủy window. Nếu conflict/write error thì hủy close, giữ buffer và cho người dùng quyết định rõ. Bao phủ app quit và các cửa sổ liên quan; không dùng timeout cưỡng bức hoặc luôn discard để thoát. Chỉ thêm recovery draft nếu có ownership, không ghi secret hay tài liệu user vào evidence.

**Nghiệm thu:** type → đóng ngay → relaunch giữ đúng nội dung; nhiều file dirty, save đang chạy, conflict và write failure; close bị chặn khi không lưu được. Test trên native Windows/app lifecycle, không chỉ gọi trực tiếp save function.

## C1 — [P2, cần điều tra] Mobile smoke exit 0 dù có native exception

**Code liên quan:** `scripts/smoke_mobile.js:158,193–195`, `src/main/pty_manager.js` close/kill lifecycle. Liên quan T23/T28c.

Hai lần chạy trong vòng review đều in `ALL CHECKS PASSED`/exit 0 nhưng có **hai stack traces `Error: AttachConsole failed`** từ `node-pty/lib/conpty_console_list_agent.js:13`. Lần đầu chạy cùng lifecycle test; lần xác nhận sau chạy riêng vẫn có cùng lỗi, nên không quy kết cho parallel test. Chưa xác định được ảnh hưởng sản phẩm hay helper/test teardown; không tuyên bố app đã crash.

Log lần chạy riêng: `evidence/codex-review-mobile-c0c5e37.log`.

**Yêu cầu Grok:** xác định root cause và ownership của helper/PTY khi kill và khi app thoát, chờ lifecycle đúng thứ tự. Harness phải phản ánh native exception liên quan thành failure thay vì chỉ dựa trên các assertion trước teardown. Không suppress stderr/AttachConsole, không kill process toàn máy và không tăng timeout để che lỗi. Báo rõ sản phẩm hay harness được sửa, kèm native rerun sạch và exit code.

## Kiểm chứng vòng này

Môi trường Windows x64; Node launcher v24.11.1, npm 11.6.3, Electron 44.9.0. Native helper trong stack trace báo Node v24.22.0 (runtime của helper), không đồng nhất với Node launcher. Tất cả fixture dùng profile/files/git/worktree tạm, không đọc API key thật.

| Kiểm tra | Kết quả |
| --- | --- |
| `npm run check` | 27 PASS, exit 0 |
| `node node_modules/electron/cli.js scripts/codex_review_regressions.js` | R1–R6 PASS, exit 0 |
| `node node_modules/electron/cli.js scripts/smoke_workbench.js` | All checks passed, exit 0 |
| `node node_modules/electron/cli.js scripts/smoke_mobile.js` | Assertions PASS/exit 0 nhưng native AttachConsole exceptions, không đánh giá sạch |
| `node node_modules/electron/cli.js scripts/lifecycle_cycles.js` | 20/20 PASS, live 0, exit 0; không phải soak |
| `node node_modules/electron/cli.js scripts/codex_review_editor_lifecycle.js` | Control PASS; **R7/R8 FAIL, exit 1**, không có harness error |
| `node --check` cho JS/MJS thay đổi và fixture mới | PASS |
| `git diff --check` | PASS trước cập nhật hồ sơ vòng này |

Evidence R7/R8: `evidence/codex-review-editor-c0c5e37-1793705277414.json`. Fixture độc lập: `scripts/codex_review_editor_lifecycle.js`. Các lượt chạy tiếp ghi file evidence theo HEAD/timestamp, không ghi đè kết quả lịch sử.

Phạm vi kết luận: R1–R6 đạt ở các ca đã chạy; T28a vẫn FAILED vì R7/R8, T23/T28c còn C1. Các hàng PARTIAL/NOT_RUN khác trong ma trận `codex-review.md` không tự trở thành VERIFIED. Build/package/install/Windows sạch/30-minute soak/CLI-provider-phone thật vẫn chưa chạy trong vòng này; public release vẫn NOT_READY.

## Giao lại Grok

Tiếp tục trên branch hiện tại, giữ các file review/evidence mới. Sửa R7/R8 trước và điều tra C1. Không thay assertion để che lỗi, không thay lịch sử evidence FAIL, không sửa production data. Chạy lại cả regression R1–R6 và editor-lifecycle, smoke/native teardown; ghi SHA mới và bằng chứng mới. Giữ NOT_RUN cho nghiệm thu chưa chạy. Local commits được phép; chưa push/PR/merge/release. Bàn giao lại Codex để review điều kiện push/PR mà người dùng đã cho phép.
