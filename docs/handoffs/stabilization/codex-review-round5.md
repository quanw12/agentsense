# Codex review vòng 5 — CHANGES_REQUESTED

Ngày 03/11/2026, Asia/Saigon. Branch `fix/workbench-stability`; HEAD `521e51c4c061a5c2932dc19a2ba0a2476a460f70`, implementation mới `cbc555d`. Diff vòng này `34b7ce3..521e51c`. Working tree đầu lượt sạch. Review không sửa implementation, commit, push, tạo PR, merge hoặc release; chỉ bổ sung evidence/tài liệu.

**R10 đã PASS, R1–R9 không regression ở các ca chạy lại. Lỗi native shutdown đã ghi từ vòng trước vẫn tái hiện, nên chưa approve push/PR. Đây là tiếp tục điều tra T23/C2, không phải lỗi editor mới.**

## R10 đã xác nhận

Đã đọc epoch guard trước task/write và sau response, cùng thao tác tăng epoch/xóa timer của Discard. Chạy lại fixture slow-IO gốc: `writeCount:1`, `writesAfterDiscard:[]`; editor/đĩa giữ external version. Evidence `evidence/codex-review-discard-pending-521e51c-1793708112146.json`, exit 0. Không hạ assertion kiểm transient write hoặc thay mock kết quả.

## C2/T23 — [P1] Native shutdown còn crash dù assertions pass

**Code/đường cần điều tra:** `src/main/pty_manager.js:245,319,384,460`; `main.js:209`; `scripts/smoke_workbench.js:193–225`; `scripts/smoke_mobile.js:213–216`.

Workbench chạy bốn lượt trên đúng HEAD hiện tại:

| Lượt | Process exit | Kết quả |
| --- | --- | --- |
| 1 | 0 | All checks passed |
| 2 | **-1073741819 = 0xC0000005** | UI assertions pass, log dừng sau `shells before exit`, không tới `all checks passed` |
| 3 | 0 | All checks passed |
| 4 | **-1073741819 = 0xC0000005** | Cùng giai đoạn như lượt 2 |

Lượt 2–4 chạy nối tiếp, không rerun chỉ để thay failure thành PASS. Log riêng `evidence/codex-review-workbench-521e51c-1.log` đến `-4.log`; exit codes lượt 2–4 ở `evidence/codex-review-workbench-521e51c-runs.json`. Lượt đầu là một tool process riêng đã kiểm exit 0.

Mobile smoke lần này in **ALL CHECKS PASSED**, nhưng tool process trả **-1073740791 = 0xC0000409**. Log `evidence/codex-review-mobile-521e51c.log` và metadata exit `evidence/codex-review-mobile-521e51c-exit.json`. Không có `AttachConsole` trong log không đồng nghĩa native teardown thành công. C1 helper exception cũ và native exit codes hiện tại phải được phân biệt.

**Phạm vi kết luận:** đã chứng minh Electron/native smoke processes thoát lỗi trong lifecycle shutdown. Chưa xác định root cause là sản phẩm/node-pty/native runtime hay cách teardown của harness; chưa khẳng định native close của app người dùng chắc chắn crash. 20 cycle create/close pass không phủ được shutdown/reload/multiple-pane trong workbench.

**Giao Grok, ưu tiên phần này trước bàn giao lại:**

1. Tái hiện trên cùng HEAD/Windows với log **exit code thực tế**, không dựa vào dòng PASS. Instrument exit/kill/native worker/conout cleanup và thời điểm process quit; ghi terminal IDs, state, PID/child ownership tại failure. Nếu cần native dump/stack, chỉ thu trên fixture, không transcript/secret/user process.
2. So sánh native BrowserWindow close/app quit bình thường với `app.exit`/`process.exit` của harness, nhiều pane và renderer reload. Tách product/native defect khỏi harness defect bằng một ca điều khiển độc lập. Không kết luận chỉ từ Map đã rỗng hoặc `alive:false`: các cờ này do app tự đổi trước khi native cleanup chắc chắn xong.
3. Rà `close_terminal`/`kill_all`: promise hiện hoàn tất theo thao tác JS/worktree, chưa chứng minh native process/socket/worker đã drain. Main `will-quit` không đợi `kill_all`; workbench gọi kill_all rồi app.exit; mobile có await kill_all rồi process.exit. Đây là các điểm cần kiểm chứng, **chưa phải root cause được xác nhận**. Rà cả `useConptyDll` đổi ở vòng trước và onExit handling.
4. Sửa đúng ownership và thứ tự teardown, idempotent/race-safe. Nếu chỉ harness sai, sửa harness và chứng minh native product close sạch; nếu sản phẩm sai, sửa sản phẩm kèm regression. Không suppress stderr/exception, nuốt nonzero exit, kill toàn máy, thêm sleep/timeout dài tùy ý để báo PASS.
5. Nghiệm thu: lặp có giới hạn nhiều lượt workbench/mobile và native product close, ghi toàn bộ pass/fail/exit, child/process/handle counts có ownership trước/sau. Sau sửa không còn các native exit lỗi chưa giải thích, không orphan; chạy lại R1–R10/Node checks/lifecycle. Soak chưa chạy giữ NOT_RUN.

## Các kiểm tra khác

| Kiểm tra | Kết quả |
| --- | --- |
| `npm run check` | 27 PASS, exit 0 |
| `scripts/codex_review_regressions.js` qua Electron | R1–R6 PASS, exit 0; R2 trạng thái conflict |
| `scripts/codex_review_editor_lifecycle.js` qua Electron | CONTROL/R7/R7_DISCARD/R8 PASS, exit 0 |
| `scripts/codex_review_conflicted_quit.js` qua Electron | SETUP/R9 PASS, exit 0 |
| `scripts/codex_review_discard_pending.js` qua Electron | Control/R10 PASS, exit 0 |
| `scripts/lifecycle_cycles.js` qua Electron | 20/20 PASS, live 0, exit 0 |
| Syntax JS diff vòng này; `git diff --check` | PASS trước cập nhật báo cáo |

Chạy script Electron bằng `node node_modules/electron/cli.js <script>`. Các JSON R1–R10 gắn HEAD `521e51c` nằm trong thư mục evidence. Không sửa evidence FAIL lịch sử. Profile/file/repo/worktree đều fixture tạm.

Build/package/install/Windows sạch/30-minute soak/real CLI-provider-phone chưa chạy trong review này; public release vẫn NOT_READY. Grok tiếp tục local, lưu SHA mới và evidence đầy đủ rồi bàn giao Codex; chưa push/PR/merge/release trong lượt sửa.
