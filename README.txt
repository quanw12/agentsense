AGENTSENSE - HƯỚNG DẪN CÀI ĐẶT / INSTALL GUIDE
===============================================

TIẾNG VIỆT
----------
1. Giải nén TOÀN BỘ file zip trước: chuột phải vào file zip -> Extract All (Giải nén tất cả).
   Không chạy file nằm bên trong file zip.
2. Mở thư mục vừa giải nén và nhấp đúp vào "Install AgentSense.cmd".
   Cài đặt chỉ dành cho tài khoản Windows của bạn, không cần quyền Administrator.
3. Nếu Windows hiện "Windows protected your PC": bấm "More info" (Thông tin thêm),
   rồi bấm "Run anyway" (Vẫn chạy). Ứng dụng chưa được ký số nên Windows có thể cảnh báo.
4. Sau khi cài xong, AgentSense có trong Start Menu và trên Desktop.
5. Ghim lên thanh tác vụ (taskbar): Start -> gõ "AgentSense" -> chuột phải ->
   "Pin to taskbar" (Ghim vào thanh tác vụ).
6. Dữ liệu (workspace, cấu hình) được lưu tại: %APPDATA%\AgentSense
   (gõ %APPDATA%\AgentSense vào thanh địa chỉ của File Explorer).
7. Các công cụ lập trình AI (Claude Code, Codex, ...) phải cài riêng.
   Claude Code trên Windows cần Git for Windows: https://git-scm.com/download/win
   Tab Terminal trong AgentSense dùng được mà không cần công cụ nào.
8. Gỡ cài đặt: nhấp đúp vào "Uninstall AgentSense.cmd".
   Dữ liệu trong %APPDATA%\AgentSense KHÔNG bị xóa. Muốn xóa thì tự xóa thư mục đó.
9. Cập nhật: giải nén bản mới và nhấp đúp vào "Install AgentSense.cmd" lại.
   Hãy đóng AgentSense trước khi cập nhật.

ENGLISH
-------
1. Unzip the WHOLE zip first: right-click the zip -> Extract All.
   Do not run files from inside the zip.
2. In the unzipped folder, double-click "Install AgentSense.cmd".
   It installs for your Windows user only. Administrator rights are not needed.
3. If Windows shows "Windows protected your PC", click "More info", then "Run anyway".
   The app is not code-signed, so Windows may warn about it.
4. After installing, AgentSense is in the Start Menu and on the Desktop.
5. To pin it to the taskbar: Start, type AgentSense, right-click it, Pin to taskbar.
6. Your data (workspaces, settings) is stored in %APPDATA%\AgentSense.
7. Coding agent tools (Claude Code, Codex, ...) must be installed separately.
   Claude Code on Windows needs Git for Windows: https://git-scm.com/download/win
   The Terminal tab works without any of them.
8. To uninstall: double-click "Uninstall AgentSense.cmd".
   Your data in %APPDATA%\AgentSense is NOT deleted. Delete that folder yourself if you want it gone.
9. To update: unzip the new version and double-click "Install AgentSense.cmd" again.
   Close AgentSense first.
