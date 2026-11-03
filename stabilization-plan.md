# AgentSense — kế hoạch ổn định trước khi review

Ngày giao việc: 03/11/2026. Người thực hiện: Grok 4.7. Người review: Codex.
Baseline đã audit: `94257b12aabe4dcb2ec48e1c2c6a74a37c71e1fa` trên `main`.

**Chỉ làm local. Không push, không merge, không PR, không tag/release/deploy.**
Branch đề xuất: `fix/workbench-stability`. Nếu đã tồn tại, kiểm tra nguồn gốc và thay đổi trước khi tiếp tục.

Mục tiêu: pane agent cố định, bấm chỉ đổi focus, kéo divider để resize; sửa các lỗi đã xác nhận,
đóng các khoảng trống kiểm chứng bằng bằng chứng hoặc ghi rõ phần còn bị chặn.

Đọc `stabilization-tasks.md` để biết yêu cầu chi tiết của từng T01–T28.
Ghi tiến độ và kết quả vào `stabilization-results.md`.

- [ ] **1. Chuẩn bị và tái hiện.** Đọc hướng dẫn repo, ghi HEAD/base SHA và trạng thái ban đầu; tạo branch đúng prefix; tái hiện bằng fixture/profile tạm. Xác minh: có kết quả trước sửa, không ảnh hưởng dữ liệu thật.
- [ ] **2. Bố cục cố định — T01–T04.** Tách focus khỏi geometry; giữ split theo workspace; một vùng file có nhiều tab. Xác minh: click/đổi agent không đổi bounds, divider resize hoạt động, reload giữ tỷ lệ.
- [ ] **3. Phiên và ngữ cảnh — T05–T12.** Lưu lựa chọn model/provider an toàn; bảo toàn worktree và phiên lỗi; chuẩn hóa resume/drop/preset. Xác minh: regression tests với restart, reload, app relaunch và hai worktree khác nội dung.
- [ ] **4. File, dữ liệu, mobile — T13–T22.** Đồng bộ file, import có phản hồi, IO không chặn, bảo vệ key/path và quyền điều khiển kích thước PTY. Xác minh: test theo tiêu chí từng mục; không giả định hành vi của CLI/dịch vụ chưa thử.
- [ ] **5. Lifecycle và nguồn phát hành — T23–T28.** Điều tra timeout, đóng gói tái lập, rollback, dev script, editor/quick-open và coverage. Chỉ chuẩn bị bản build/manifest local; điều kiện bên ngoài thiếu thì ghi BLOCKED/NOT_RUN.
- [ ] **6. Kiểm chứng cuối và bàn giao review.** Chạy bộ test theo hợp đồng UX mới, build app, thử cài/nâng cấp/gỡ trong sandbox; ghi SHA/log/ảnh và toàn bộ phần chưa đạt. Dừng ở trạng thái `READY_FOR_CODEX_REVIEW`, tuyệt đối chưa push.

Các bước được chia nhỏ tiếp trong quá trình làm. Không tự hạ phạm vi, bỏ ID, đổi tiêu chí để test xanh,
hoặc coi kiểm tra bằng mock là thay thế kiểm tra native/CLI thật.

Chỉ người review mới kết luận `APPROVED_FOR_PUSH`; Grok chỉ được kết luận đã sẵn sàng để review.
