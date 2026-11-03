# AgentSense — đánh giá khả năng phát hành

Ngày: 03/11/2026. Code kiểm tra: `main`, commit `94257b1`.

## Kết luận

Phù hợp để tiếp tục test nội bộ. Chưa đủ bằng chứng để gọi là bản stable cho người dùng rộng rãi.
Nên sửa các điểm dưới đây, sau đó phát hành prerelease Windows x64 cho nhóm thử nghiệm nhỏ.

## Kết quả kiểm tra thực tế

| Hạng mục | Kết quả |
| --- | --- |
| Cập nhật code | Local main đã fast-forward lên origin/main; working tree sạch |
| Workbench | 25 kiểm tra qua; lượt chạy mới bị timeout 120 giây sau kiểm tra renderer errors, trong đoạn dọn/đóng phiên; kiểm tra cuối về bảo toàn worktree chưa chạy xong |
| Mobile | Toàn bộ kiểm tra HTTP/WebSocket, xác thực, attach/input và tạo/đóng phiên qua; có log AttachConsole failed từ helper node-pty lúc teardown |
| Cài mới | Qua, dùng payload Electron thật, đích cài và shortcut đều nằm trong thư mục tạm |
| Nâng cấp | Qua, file cũ dư được loại bỏ và dữ liệu mẫu trong profile được giữ nguyên |
| Gỡ cài đặt | Qua, app và shortcut được gỡ; dữ liệu mẫu được giữ nguyên |
| Dependency audit | npm audit --omit=dev báo 0 advisory; kết quả này không thay cho audit toàn bộ app |
| Binary Windows | Có dist/win-unpacked/AgentSense.exe; chữ ký số: NotSigned |

Các kiểm tra cài đặt chạy trên máy phát triển với thư mục/profile tạm, chưa phải Windows sạch.
Không thay đổi bản cài đang dùng, dữ liệu cá nhân, visibility GitHub hoặc phát hành release.

## Cần xử lý trước khi phát hành

1. **Xác định timeout khi đóng phiên.** Bộ test từng qua ở lượt trước, nhưng lượt này không hoàn tất.
   Cần phân biệt lỗi cleanup của test với lỗi lifecycle ConPTY của app, rồi kiểm tra đóng/mở lặp lại.
2. **Giữ cấu hình model/API khi khởi động lại.** `seat_spec` truyền env_extra khi tạo phiên,
   nhưng session_store không lưu trường này; restore/restart không tái dựng cấu hình.
   Đã xác nhận bằng lời gọi make_record với env_extra mẫu: trường bị loại bỏ.
   Cách sửa nên lưu lựa chọn model/provider và bảo vệ secret phù hợp, tránh ghi thêm API key thuần vào session record.
3. **Đồng bộ payload phát hành.** Hash terminal_grid.js trong `app/` khác source;
   hash trong `dist/win-unpacked/resources/app/` trùng source. Installer lấy payload từ `app/`.
   Quy trình phát hành phải build mới, đồng bộ payload, kiểm tra version/hash rồi mới tạo zip.
4. **Chuẩn hóa version và artifact.** Chưa có .github/workflows, git tag hay CHANGELOG trong checkout.
   Cần quy trình build/test theo tag, tên artifact có version, checksum và release notes.
   Nâng cấp hiện tại là tải bản mới và chạy lại installer; chưa có auto-updater.
5. **Chọn nơi tải công khai.** GitHub connector xác nhận repository đang private.
   Cần một nơi phân phối mà người dùng mục tiêu truy cập được; chưa tự thay đổi visibility.

## Trước bản stable

- Kiểm tra trên Windows sạch, tài khoản thường, đường dẫn có khoảng trắng/tiếng Việt,
  máy thiếu CLI/Git, nâng cấp giữa hai phiên bản và khôi phục phiên sau khi app đóng bất thường.
- Kiểm tra hội thoại thật với các CLI chủ lực và chạy nhiều agent trong thời gian dài.
- Bảo vệ API key: providers_store hiện ghi api_key trực tiếp vào providers.json.
- Xem xét code signing để cải thiện trải nghiệm tải/chạy trên Windows.
- Thử nghiệm theo kênh `v1.0.0-beta.1`, `v1.0.0-beta.2`, rồi `v1.0.0` khi đạt tiêu chí ổn định.

## Mã liên quan

- `scripts/smoke_workbench.js`, `scripts/smoke_mobile.js`
- `install.ps1`, `uninstall.ps1`, `scripts/build_app.mjs`, `package.json`
- `src/renderer/terminal_grid.js`: seat_spec, restore_saved_in_grid, restart_pane
- `src/main/session_store.js`: normalize_record, make_record
- `src/main/providers_store.js`: write_providers
