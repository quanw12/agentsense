# Codex review vòng 3 — CHANGES_REQUESTED

Ngày 03/11/2026, Asia/Saigon. Branch `fix/workbench-stability`; HEAD `28102e32ab41b74dbd7219d823d6697528984395`. Implementation mới `e6e3d86`, diff review `c0c5e37..28102e3`.

**R1–R8 PASS trong các ca cũ; C1 không còn tái hiện ở lượt mobile smoke hiện tại. Còn R9 [P1] mất buffer conflict khi quit, nên chưa push/tạo PR.** Working tree đầu lượt sạch; review chỉ thêm fixture/evidence/tài liệu, không sửa implementation, commit, push, PR, merge hay release.

## R9 — [P1] Quit bỏ qua file đã ở trạng thái conflict

**Code:** `src/renderer/terminal_grid.js:1442–1457`, đặc biệt dòng 1450; `main.js:139–151`. Liên quan bảo toàn buffer qua conflict và native app close của R2/R8/T28a.

`flush_dirty_editors` có `if (file.conflict || !file.dirty || file.editable === false) continue`. File đã conflict không vào pending và không làm `blocked` thành true. Main nhận `{ok:true}`, đặt `flush_complete` và đóng cửa sổ, dù buffer chưa lưu, chưa được người dùng discard và không có recovery persistence. Tránh ghi đè external file là đúng, nhưng skip conflict để cho quit làm mất bản sửa.

**Tái hiện độc lập trên native Windows:** mở file fixture có `original`, gõ `UNSAVED BUFFER TO KEEP`, sửa file từ ngoài thành `EXTERNAL DISK VERSION`. Đợi UI báo `conflict`, xác nhận editor còn buffer. Đóng native BrowserWindow qua `.close()` bình thường. **FAIL:** sự kiện `closed` xảy ra, đĩa vẫn chỉ có external version; buffer chưa lưu mất, không có user discard. Harness chỉ kết thúc process sau khi ghi nhận native close; không có PTY hoặc dữ liệu thật.

Fixture: `scripts/codex_review_conflicted_quit.js`, **exit 1**, SETUP PASS/R9 FAIL, không có harness error. Evidence: `evidence/codex-review-conflicted-quit-28102e3-1793706463362.json`.

**Giao Grok:** dirty/conflict buffer phải được tính vào quyết định close. Khi chưa resolve/discard thì giữ cửa sổ, buffer và hiển thị file cần xử lý; hoặc phải có recovery bền vững thật sự trước khi đóng. Không tự overwrite external file và không coi nhìn thấy conflict là đồng ý discard. Sau khi xử lý rõ ràng, close tiếp theo mới được phép.

**Nghiệm thu:** conflict có trước quit, conflict mới khi flush, write error, dirty file bình thường, nhiều file/workspace sạch/dirty/conflict. Với conflict, close bị chặn và buffer còn nguyên trừ khi người dùng chủ động discard hoặc dữ liệu đã được bảo toàn có thể khôi phục. Chỉ dirty file bình thường thì lưu đúng và thoát được.

**Sửa khoảng trống test:** `codex_review_editor_lifecycle.js` tạo conflict A ở R7 rồi giữ mở khi chạy R8. R8 chỉ assert B được ghi khi app đóng, không kiểm A được bảo toàn, nên PASS dù A mất. Nếu chặn quit đúng, fixture cũ có thể timeout vì A chưa resolve. Tách R7 và normal-close R8 sang app/profile độc lập, hoặc dùng hành động resolve/discard rõ ràng trước normal-close. Giữ ca known-conflict quit R9 riêng. Không bỏ assertion bảo toàn hoặc skip conflict để pass test cũ.

## Kiểm chứng độc lập

| Kiểm tra | Kết quả |
| --- | --- |
| `npm run check` | 27 PASS, exit 0 |
| `scripts/codex_review_regressions.js` qua Electron | R1–R6 PASS, exit 0 |
| `scripts/codex_review_editor_lifecycle.js` qua Electron | CONTROL/R7/R8 PASS, exit 0; khoảng trống kiểm A như trên |
| `scripts/codex_review_conflicted_quit.js` qua Electron | SETUP PASS, **R9 FAIL, exit 1** |
| Workbench smoke | All checks passed, exit 0 |
| Mobile smoke | All checks passed, exit 0, không có AttachConsole/native exception |
| `scripts/lifecycle_cycles.js` qua Electron | 20/20 PASS, live 0, exit 0 |
| JS syntax diff vòng này và fixture mới; `git diff --check` | PASS trước cập nhật tài liệu |

Chạy script Electron bằng `node node_modules/electron/cli.js <script>`. Profile/files/git/worktree đều tạm. Evidence bổ sung: `evidence/codex-review-regressions-28102e3-1793706436211.json`, `evidence/codex-review-editor-28102e3-1793706427751.json`, `evidence/codex-review-mobile-28102e3.log`. Không sửa evidence lịch sử.

C1: đã đọc đường DLL/non-DLL của dependency node-pty local; `useConptyDll:true` tránh console-list helper của kill path trước. Native smoke/lifecycle lượt này sạch, không thay thế soak/Windows sạch.

Build/package/install/Windows sạch/30-minute soak/CLI-provider-phone thật và các nghiệm thu PARTIAL khác chưa chạy lại; public release vẫn NOT_READY. Ma trận/bằng chứng trước giữ nguyên lịch sử, không tự đổi mọi requirement thành VERIFIED.

Grok tiếp tục local trên branch này, giữ file review mới, sửa R9 và tách test lifecycle đúng như trên. Chạy regression cũ và ca mới, ghi SHA/evidence mới, bàn giao Codex review. Chưa push/PR/merge/release trong lượt sửa.
