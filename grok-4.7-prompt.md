# Prompt giao cho Grok 4.7

Bạn là kỹ sư thực hiện việc ổn định AgentSense, một ứng dụng Electron chạy CLI agent trên Windows.
Hãy trực tiếp đọc code, sửa, kiểm tra và bàn giao thay đổi local; không chỉ trả lời bằng kế hoạch.

## Đọc trước

Repo trên máy hiện tại: `C:\StudyBase\AgentSense`.
Nếu môi trường của bạn khác, xác định repo root thật; không dùng đường dẫn đoán.
Đọc theo thứ tự:

1. `AGENTS.md` áp dụng nếu có, `CONTRIBUTING.md`, `package.json`.
2. `stabilization-plan.md`.
3. `stabilization-tasks.md` — đặc tả T01–T28 và tiêu chí nghiệm thu.
4. `docs/handoffs/stabilization/audit.md` và các file bằng chứng đi kèm.
5. `stabilization-results.md` — cập nhật file này xuyên suốt công việc.

Baseline đã audit là `94257b12aabe4dcb2ec48e1c2c6a74a37c71e1fa` trên `main`.
Đó là mốc tham chiếu, không phải lệnh reset repo về commit đó. Nếu repo đã có code mới,
hãy ghi SHA thực tế, so sánh và xác minh lại các lỗi trước khi sửa.

## Giới hạn bắt buộc do người dùng yêu cầu

- **KHÔNG PUSH** bất kỳ branch/ref/tag nào, kể cả force push.
- Không merge vào main, tạo/cập nhật PR, đăng comment/issue, publish release, upload artifact,
  deploy website, đổi visibility repo hoặc bật workflow phát hành trên remote.
- Không tự kết luận đã được phép push khi tests pass. Codex phải review code và bằng chứng trước.
- Được tạo branch local tên `fix/workbench-stability` và các commit local nhỏ, Conventional Commits.
  Không dùng tên branch chứa tên công cụ AI hay sản phẩm tham khảo. Không amend commit đã có trên remote.
- Không reset/clean/xóa hoặc ghi đè thay đổi có sẵn của người dùng. Ghi lại trạng thái ban đầu.
- Không đóng agent đang làm việc, sửa profile thật, đọc/log API key thật hoặc dùng repo dự án thật làm fixture.
  Kiểm tra bằng userData, file, repo git và worktree tạm. Không cài hàng loạt CLI hay đăng nhập hộ người dùng.
  Mọi lần start/dev/chạy exe để test phải đặt `AGENT_HUB_USER_DATA` trỏ tới profile fixture trong tiến trình test;
  không dùng profile mặc định hoặc thay biến môi trường/registry toàn hệ thống.
- Không tắt cơ chế xác thực, boundary, signature verification hoặc bỏ test để làm cho kết quả trông xanh.

## Hợp đồng UX quan trọng nhất

Các agent nằm trong các pane/split cố định và có thể xem đồng thời.
Bấm vào terminal, tab, agent ở sidebar hoặc dùng phím chuyển focus chỉ đổi focus/viền chọn.
Thao tác đó không được phóng to, ẩn pane khác, thay tỷ lệ, đổi vị trí hay cuộn cả workbench bất ngờ.
Người dùng kéo divider trái/phải hoặc trên/dưới để điều chỉnh kích thước.
Không giữ lại hành vi double-click tự maximize hoặc Tabs thay một pane toàn màn hình trong luồng mặc định.
Di trú state Tabs/zoom cũ về bố cục cố định. Không tái tạo các terminal chồng cùng FULL_RECT rồi ẩn/hiện.

File mở trong một vùng preview/editor riêng với nhiều tab. Chọn file khác thay nội dung/tab trong cùng
vùng đó; không chẻ thêm một pane mới cho mỗi file. Panel cây file tiếp tục ở bên phải.
Giữ phong cách tối và hệ thống UI đang có; tránh đổi framework/thiết kế toàn bộ khi không cần.

## Cách làm

1. Kiểm tra git status, HEAD và hướng dẫn repo; tạo branch local an toàn. Không chạy đồng thời checkout/sửa file với test phụ thuộc các file đó.
2. Thực hiện theo các giai đoạn trong plan; theo dõi đầy đủ T01–T28 và các mục con T26/T28.
3. Mỗi lỗi cần tái hiện trước sửa, regression test có ý nghĩa, rồi kiểm tra sau sửa.
   Có thể dùng mock để kiểm tra logic nhưng phải ghi ranh giới; mock không chứng minh ConPTY/CLI/network thật đã ổn.
4. Chạy app thật trên Windows để xác minh UI, resize, focus, terminal lifecycle và bản đóng gói.
   Các command npm hiện có là điểm khởi đầu; đọc script và sửa expectation không phù hợp hợp đồng UX mới.
5. Với phiên/model/provider, không lưu thêm secret thuần vào localStorage/preset/session để sửa lỗi restore.
   Dùng lựa chọn model/provider có kiểu rõ ràng và resolve secret ở main process.
6. Với CLI, chỉ dùng cờ/env/resume thực sự được phiên bản đó hỗ trợ, đối chiếu help/tài liệu chính thức.
   CLI chưa có, thiếu tài khoản, thiếu máy sạch/thiết bị hoặc chứng chỉ: ghi NOT_RUN/BLOCKED cụ thể.
7. Không tự mở scope sang remote service công khai. Với T22, giữ phạm vi LAN/VPN được kiểm tra và công bố rõ giới hạn.
   Với T26, chuẩn bị code/manifest/workflow local; ký số, public download và update production cần điều kiện bên ngoài.
8. Ghi log lệnh, exit code, môi trường, thời lượng, ảnh và SHA; không ghi secret hoặc nội dung dự án riêng tư.
9. Khi sắp hết context, cập nhật results để có thể tiếp tục. Không đánh dấu DONE chỉ vì hết thời gian/context.

## Điều kiện hoàn tất và điểm dừng

Mỗi mục phải có một trạng thái chính xác: PENDING, IN_PROGRESS, FIXED_VERIFIED,
IMPLEMENTED_NOT_VERIFIED, FAILED, NOT_RUN hoặc BLOCKED.
`FIXED_VERIFIED` chỉ áp dụng khi tất cả tiêu chí liên quan đã có bằng chứng; nếu một mục lớn còn thiếu
thiết bị/tài khoản/chứng chỉ thì giữ trạng thái chưa hoàn tất và ghi kết quả từng mục con.

Trước khi dừng, cung cấp:

- Branch local, SHA bắt đầu, base SHA dùng để review, danh sách commit local và git status cuối.
- Bảng T01–T28 đầy đủ, code đã đổi, nguyên nhân, cách kiểm tra, lệnh/log/ảnh và hạn chế.
- Ma trận CLI/OS/device thật đã thử; phân biệt smoke, regression, native integration, real-provider và soak.
- Build/artifact local có version/hash, không lẫn dữ liệu hoặc đường dẫn cá nhân.
- Vấn đề còn lại và phụ thuộc bên ngoài; đánh giá riêng local review readiness và public release readiness.
- Các lệnh/đường dẫn để Codex tái kiểm chứng. Không tự đổi bộ audit để che lỗi; kết quả trước sửa giữ nguyên.

Kết thúc bằng câu: **“READY_FOR_CODEX_REVIEW — chưa push, chưa merge, chưa phát hành.”**
Nếu còn lỗi hoặc bị chặn, ghi rõ trong báo cáo; câu bàn giao chỉ có nghĩa mời review, không có nghĩa app đã ổn định.
Sau đó dừng và chờ Codex review. Không thực hiện bước remote nào.
