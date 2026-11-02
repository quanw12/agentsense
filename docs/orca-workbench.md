# AgentSense workbench — đối chiếu Orca

Ngày kiểm tra: 02/11/2026. Bắt đầu từ `origin/main` tại `b114352`.
Tham khảo cấu trúc [stablyai/orca](https://github.com/stablyai/orca) tại
`c05ce970eb8bd147360db9ae5f948d195df6202b` và ba ảnh người dùng cung cấp.
Giữ giao diện tối hiện có; triển khai bằng Electron, vanilla JS, xterm.js và
node-pty của AgentSense. Không đưa framework hay mã nguồn Orca vào ứng dụng.

| Chức năng trong ảnh | AgentSense sau thay đổi | Cách sử dụng / giới hạn |
| --- | --- | --- |
| Cây file bên phải, nút toggle ở mép phải | Đã triển khai | Files / Ctrl+Shift+E; kéo đường ngăn để đổi độ rộng; nhớ trạng thái sau reload/restart |
| Bấm file mở trong khu vực làm việc cùng terminal | Đã triển khai | File mới tách phía dưới pane đang chọn; bấm lại dùng tab cũ |
| Chuyển file và agent bằng tab | Đã triển khai | Tab view / Split view; Ctrl+Tab, Ctrl+Shift+Tab; phím mũi tên/Home/End khi focus thanh tab |
| Split, resize và phóng to terminal | Giữ và kết nối với tab | Kéo header để xếp pane, kéo đường ngăn để resize, double-click header để phóng to; chuyển tab vẫn hoạt động khi phóng to |
| Nhiều CLI agent cấu hình sẵn | 14 mục + lệnh CLI tùy chọn | Claude, Codex, Gemini, Copilot, Pi, Hermes, Cursor, Droid, OpenCode, DeepSeek Harness, Grok, Kimi, Antigravity, Terminal |
| Kéo file vào agent tương ứng | Đã điều chỉnh | Kéo từ cây file, tab file hoặc Explorer vào pane/tab agent nhận; chỉ dán đường dẫn, không gửi prompt |
| File ngoài workspace / ảnh từ Explorer | Có | Copy vào cwd của phiên nhận, rồi dán đường dẫn; hỗ trợ ảnh bằng đường dẫn, không cam kết protocol clipboard ảnh riêng của mọi CLI |
| Agent trong worktree riêng | Sửa đích copy và đường dẫn | Dùng cwd thực tế của phiên; không còn copy nhầm vào workspace gốc. File nguồn nằm ngoài cwd được copy vào gốc cwd, thêm `(1)`, `(2)` nếu trùng tên |
| File ẩn | Có | Dotfiles xuất hiện trong cây thư mục |
| Xem text, ảnh, PDF, media, Word | Có sẵn, hoạt động với tab mới | Text là preview chỉ đọc; PDF/media/docx dùng viewer hiện có |
| Editor VS Code và autosave như Orca | Chưa có | Bản này dùng preview; Open mở ứng dụng mặc định để sửa file. Không quảng cáo là Monaco editor hay autosave |
| Quick-open và tìm kiếm toàn repo như Orca | Chưa có | Duyệt cây file và tab; chưa thêm bộ index/tìm kiếm toàn repo |
| Mobile và trạng thái agent | Giữ nguyên | Mobile có smoke test; hook trạng thái chi tiết hiện dành cho Claude, agent khác hiển thị trạng thái tiến trình |

## CLI và lệnh cài

Các mục CLI được tích hợp sẵn trong danh mục, còn executable và đăng nhập/subscription
thuộc môi trường của người dùng. Chỉ bấm Install mới chạy lệnh cài; thay đổi này
không tự cài hoặc đăng nhập các agent vào máy.

Đã đối chiếu các mục bổ sung với tài liệu chính thức:

- [Gemini CLI](https://github.com/google-gemini/gemini-cli): `npm i -g @google/gemini-cli`.
  Tài liệu hiện tại ghi Enterprise Code Assist/API; Google personal plans dùng Antigravity.
- [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli):
  `npm i -g @github/copilot`; Node.js 22+, PowerShell 6+ trên Windows.
- [Pi](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md):
  tài liệu hiện trỏ sang `@earendil-works/pi-coding-agent`, Node.js 22.19+.
- [Hermes trên Windows](https://hermes-agent.nousresearch.com/docs/user-guide/windows-native):
  executable `hermes`, installer PowerShell chính thức của NousResearch.

CLI tùy chọn: mở **New session → Run another CLI agent**, nhập executable/lệnh
và tên hiển thị rồi bấm **Run CLI**. Có thể bật worktree trước khi chạy.
Phiên được lưu/khôi phục như các terminal khác; chưa thêm CLI tùy chọn vào preset danh mục.

## Kiểm tra

- `npm install`.
- `npm run start`: mở app Windows, kiểm tra giao diện thực tế.
- `npm run smoke:workbench`: renderer thật + preload/IPC thật + PowerShell/ConPTY,
  với profile, repository, file và worktree tạm. Kiểm tra launch, cây file bên phải,
  dotfiles, preview, tab reuse, Tab/Split, phóng to, phím tắt, resize/refit,
  drag/drop đúng agent/cwd, bảo toàn file trùng tên, external attachment, reload,
  reattach và CLI tùy chọn. Không dùng tài khoản agent hay dữ liệu cá nhân.
- `npm run smoke:mobile`: xác thực HTTP/WebSocket, attach/input, tạo/đóng phiên.
- `npm run dist`: đóng gói Windows x64.

Chưa kiểm tra cuộc hội thoại thực tế với từng dịch vụ AI: cần CLI đã cài và tài khoản
của người dùng. Một phiên Claude cũ trong profile hiện tại báo không tìm thấy session ID;
Restart mở một phiên mới. Không tự động đổi sang hội thoại mới khi restore thất bại.
