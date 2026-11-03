# Codex review vòng 4 — CHANGES_REQUESTED

Ngày 03/11/2026, Asia/Saigon. Branch `fix/workbench-stability`; HEAD `34b7ce321ffd574d03dec7275bcc08bb25696e5c`. Review implementation `b03fed0`, diff `28102e3..34b7ce3`. Working tree đầu lượt sạch. Review chỉ bổ sung fixture/evidence/tài liệu, không sửa implementation/commit/push/PR/merge/release.

**R9 đã đạt:** known conflict chặn native close và giữ buffer. Explicit Discard giữ external file trong ca không có save đang chờ. R1–R8 chạy lại pass. Còn lỗi R10 trong luồng Discard mới, nên chưa approve push/PR.

## R10 — [P2] Save đã xếp hàng vẫn ghi bản sửa cũ sau khi Discard

**Code:** `src/renderer/terminal_grid.js:1389–1392,1404–1409,1444–1455`.

`enqueue_save` giữ snapshot/generation trong closure của từng task. Discard chỉ đặt lại conflict/dirty/loaded rồi reload, không hủy snapshot cũ trong `save_tail`. `perform_save` dùng snapshot cũ nhưng lấy `file.mtime` mới tại thời điểm task chạy, nên sau reload nó có thể ghi snapshot đã discard lên bản external hợp lệ. Generation hiện chỉ được kiểm sau write để lên lịch save mới, chưa ngăn write cũ.

**Fixture slow-IO độc lập:** renderer và file IO thật, profile/file tạm. Sau known conflict, pause lần IPC write đầu tiên, gõ tiếp và đợi debounce thứ hai xếp hàng. Bấm Discard, rồi thả request đầu. Handler test vẫn gọi production `write_text`; chỉ thêm pause để kiểm soát thứ tự, không fake kết quả write, không sửa implementation.

Kết quả ghi nhận sau Discard:

1. Control: đĩa và editor có `EXTERNAL VERSION TO PRESERVE`.
2. Task cũ ghi **OLD AUTOSAVE TWO** xuống đĩa; fixture đọc xác nhận nội dung này ngay sau successful write.
3. Autosave tiếp theo ghi trả lại **EXTERNAL VERSION TO PRESERVE**.

**Đây là overwrite tạm thời đã tái hiện, không khẳng định mất dữ liệu vĩnh viễn trong ca test.** Agent/file watcher/build hoặc ứng dụng khác có thể quan sát/xử lý nội dung đã bị người dùng discard trong khoảng đó; nếu tiến trình dừng giữa hai write, đĩa chứa nội dung bị discard. Không được coi final contents đúng là đã bảo vệ Discard.

**Giao Grok:** đồng bộ Discard với queue/in-flight saves; invalidate snapshot thuộc lượt chỉnh sửa trước Discard trước khi chúng được phép write, xử lý response cũ không thay metadata/buffer mới. Có thể chờ in-flight operation an toàn rồi reload, hoặc dùng save epoch/cancellation phù hợp. Giữ revision external-file check; không ghi đè external version và không dựa vào autosave sau để sửa lại stale write.

**Nghiệm thu:** Discard với 0/1/nhiều save pending, slow IO, lỗi/conflict, đổi tab và close/quit trong quá trình đó. Sau thao tác Discard, không successful write nào được ghi discarded snapshot; buffer/đĩa cuối đúng external version. Test cho phép Discard chờ in-flight IO; gate được release độc lập với thời điểm reload, nên không ép cách triển khai phải reload ngay.

Fixture `scripts/codex_review_discard_pending.js`, **exit 1**, control PASS/R10 FAIL, không có harness error. Evidence đầy đủ nhất: `evidence/codex-review-discard-pending-34b7ce3-1793707417778.json`.

Evidence `...1793707292657.json` của lần đầu chỉ kiểm final contents nên PASS nhưng thiếu assertion kiểm các write tạm thời. Lượt `...1793707338171.json` bổ sung audit write cho thấy cùng lỗi; lượt cuối bổ sung gate release độc lập để hỗ trợ cách sửa drain-before-reload. Giữ cả lịch sử để không biến test yếu thành chứng minh đã an toàn.

## Kiểm chứng vòng này

| Kiểm tra | Kết quả |
| --- | --- |
| `npm run check` | 27 PASS, exit 0 |
| `scripts/codex_review_regressions.js` | R1–R6 PASS, exit 0; R2 lần này chụp trạng thái `saving`, còn fixture R7 xác nhận conflict thật và giữ buffer |
| `scripts/codex_review_editor_lifecycle.js` | CONTROL/R7/R7_DISCARD/R8 PASS, exit 0 |
| `scripts/codex_review_conflicted_quit.js` | SETUP/R9 PASS, exit 0 |
| `scripts/codex_review_discard_pending.js` | Control PASS, **R10 FAIL, exit 1** |
| Mobile smoke | All checks passed, exit 0; không có native exception trong log |
| Workbench smoke | Lần đầu timeout `test shells exit` tại `scripts/smoke_workbench.js:194`; lần xác nhận chạy riêng PASS/exit 0. Không coi lần PASS sau là xóa failure trước |
| Lifecycle | 20/20 PASS, live 0 |

Chạy các script Electron bằng `node node_modules/electron/cli.js <script>`. Log run riêng workbench ở `evidence/codex-review-workbench-34b7ce3.log`; mobile ở `evidence/codex-review-mobile-34b7ce3.log`. Các JSON R1–R9 trong thư mục evidence gắn HEAD `34b7ce3`. Không sửa evidence lịch sử.

**Theo dõi T23:** timeout shell exit một lần chưa xác định product/native/harness. Grok cần ghi terminal IDs, alive/status/lifecycle tại timeout và kiểm trình tự shutdown. Không suppress lỗi hoặc chỉ tăng timeout. Một lượt chạy riêng pass chưa chứng minh tính ổn định; không báo soak/native lifecycle hoàn tất.

Build/package/install/Windows sạch/30-minute soak/CLI-provider-phone thật và các nghiệm thu PARTIAL khác chưa chạy lại. Public release vẫn NOT_READY. Tiếp tục local sửa R10, cập nhật regression meaningful và evidence SHA mới; chưa push/PR/merge/release trong lượt Grok sửa.
