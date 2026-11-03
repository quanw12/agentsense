# Hồ sơ đầu vào cho lượt ổn định AgentSense

Các file ở thư mục này là bằng chứng của lượt audit, không phải kết quả Grok đã sửa xong.
Mốc code: `94257b12aabe4dcb2ec48e1c2c6a74a37c71e1fa`, ngày 03/11/2026.

- `audit.md`: 28 vấn đề/giới hạn đã ghi nhận, nhãn tái hiện/mã nguồn/chưa kết luận.
- `release-readiness.md`: lần đánh giá cài đặt và phân phối trước đó.
- `evidence/audit-workbench-results.json`: kết quả fixture Electron/main/terminal tạm.
- `evidence/audit-files-results.json`: kết quả fixture file/junction/import/session record.

Các đường dẫn máy trong evidence là đường dẫn fixture cũ, không phải target để sửa/xóa.
Tái hiện phải tạo fixture mới. Không thay đổi kết quả gốc để thể hiện bản sửa đã pass.

Tài liệu thực hiện nằm ở repo root:

1. `grok-4.7-prompt.md`
2. `stabilization-plan.md`
3. `stabilization-tasks.md`
4. `stabilization-results.md`

Quy tắc cuối: local branch/local commits được phép; **không push/merge/PR/tag/release/deploy**.
Codex review code và bằng chứng trước khi quyết định bước remote tiếp theo.
