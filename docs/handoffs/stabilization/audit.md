# AgentSense — các vấn đề đã xác nhận và khoảng trống kiểm chứng

Code: `main`, `94257b1`. Ngày rà: 03/11/2026.

Ưu tiên P1: ảnh hưởng luồng sử dụng chính hoặc cần xử lý trước public beta.
P2: lỗi chức năng/đồng bộ hoặc rủi ro cần xử lý trước stable. P3: thiếu tiện ích/quy trình.
Nhãn **tái hiện** nghĩa là đã chạy kiểm tra riêng; **mã nguồn** nghĩa là xác nhận cơ chế từ code;
**chưa kết luận** nghĩa là hiện tượng có thật nhưng chưa xác định nguyên nhân.

## Yêu cầu bố cục được chốt từ phản hồi người dùng

- Mỗi agent có vùng cố định, có thể xem đồng thời các pane.
- Bấm pane, tab hoặc agent trong sidebar chỉ đổi focus/đánh dấu pane tương ứng.
- Bấm kiểm tra một agent không tự phóng to, ẩn các agent khác hoặc sắp xếp lại bố cục.
- Kéo thanh chia để mở rộng/thu hẹp; lưu tỷ lệ và vị trí theo workspace.
- Mở file trong một vùng preview/editor có tab, tránh tạo thêm một split cho mỗi file.

## Giao diện và bố cục

1. **[P1, tái hiện] Chọn agent có thể thay pane chiếm toàn vùng làm việc.**
   Tabs chỉ hiển thị một pane với FULL_RECT; khi đang zoom, select_tab chuyển trạng thái zoom sang pane vừa chọn.
   Split bình thường, không zoom: kiểm tra click cho thấy kích thước không đổi. Hiện tượng nhảy phụ thuộc
   trạng thái Tabs/zoom mà app giữ; thao tác hiện tại chưa phù hợp yêu cầu cố định của người dùng.
   Mã: `src/renderer/terminal_grid.js:1355`, `:1500`, `:1641`.

2. **[P1, tái hiện] Mất tỷ lệ split sau reload/restart.**
   Kéo hai pane thành khoảng 595/335 px; reload trở về khoảng 465/465 px.
   save_ui chỉ lưu panel file, độ rộng panel và mode, không lưu split tree, tỷ lệ, vị trí, file mở hoặc pane chọn.
   Mã: `src/renderer/terminal_grid.js:46`, `:1400`.

3. **[P1, tái hiện] Mở nhiều file chia pane nhỏ đến mức không sử dụng được.**
   Mỗi file mới tách phía dưới pane đang chọn. Mở sáu file liên tiếp tạo các vùng cao lần lượt khoảng
   174, 84, 39, 16 và 5 px. Giới hạn kích thước khi kéo divider không ngăn việc chèn split mới nhỏ hơn mức tối thiểu.
   Mã: `src/renderer/terminal_grid.js:1092`, `:1250`.

4. **[P2, mã nguồn] Mode Tabs/Split là trạng thái chung cho mọi workspace.**
   Đổi mode ở một workspace cập nhật các workspace khác; giá trị được lưu và dùng cho lần mở app sau.
   Người dùng không có một cấu hình bố cục độc lập đầy đủ cho từng dự án.
   Mã: `src/renderer/terminal_grid.js:364`, `:410`.

## Phiên agent, model và worktree

5. **[P1, tái hiện ở tầng record] Không giữ model/API theo phiên qua restore/restart.**
   env_extra dùng ở lần launch đầu nhưng bị loại khỏi session record. Restart cũng không truyền lại env đã chọn.
   Thử make_record với model và endpoint mẫu: kết quả không còn env_extra.
   Mã: `src/main/session_store.js:38`, `src/main/pty_manager.js:193`,
   `src/renderer/terminal_grid.js:1878`.

6. **[P1, tái hiện] Worktree sau renderer reload có thể Restart thất bại.**
   to_info không trả worktree/base_cwd; reattach tạo pane thiếu metadata. Khi phiên đó đã exit và người dùng Restart,
   close_terminal dọn worktree sạch rồi renderer lại launch bằng cwd vừa bị dọn.
   Kết quả thực tế: `cwd does not exist`; thư mục worktree sạch được dọn, không có lỗi xóa file bẩn trong test này.
   Mã: `src/main/pty_manager.js:101`, `src/renderer/terminal_grid.js:204`, `:1878`.

7. **[P1, mã nguồn] Restore lỗi tự bỏ saved record.**
   Nếu launch lại thất bại, ví dụ thư mục đang tạm không truy cập được, renderer gọi sessions.discard.
   Chưa có luồng giữ phiên lỗi để Retry/Locate folder; thông tin phục hồi bị bỏ mặc dù người dùng chưa chủ động quên phiên.
   Mã: `src/renderer/terminal_grid.js:1824`.

8. **[P2, mã nguồn + quan sát trước] Restore pane chưa phải resume hội thoại cho từng CLI.**
   App có tham số resume riêng cho Claude; các CLI còn lại được chạy lại bằng command đã lưu,
   chưa có cơ chế resume riêng theo agent. Một phiên Claude trong profile thật trước đó đã báo không tìm thấy session ID.
   Mã: `src/main/pty_manager.js:143`, `src/renderer/terminal_grid.js:1847`.

9. **[P2, mã nguồn] Preset chỉ lưu danh sách agent.**
   Preset chưa giữ model, provider, lựa chọn worktree hoặc bố cục/tỷ lệ; người dùng cần chọn lại các phần này.
   Mã: `src/renderer/launch_page.js:539`.

10. **[P2, mã nguồn] Cây file dùng workspace gốc ngay cả khi agent đang chạy worktree.**
    File agent sửa trong worktree không phải file đang hiện trong cây/preview của repo gốc.
    Chưa có context file theo worktree được chọn, dễ xem nhầm phiên bản file.
    Mã: `src/renderer/terminal_grid.js:589`.

11. **[P2, mã nguồn + test drop trước đó] Kéo file repo gốc vào worktree tạo bản copy ở gốc cwd.**
    Đường dẫn thư mục tương đối không được ánh xạ. Ví dụ `src/foo.js` có thể thành `<worktree>/foo.js`,
    hoặc tên có `(1)` nếu trùng. Đó là staging attachment, chưa phải thao tác chọn đúng `src/foo.js` của worktree.
    Mã: `src/renderer/terminal_grid.js:775`, `src/main/ipc_files.js:213`.

12. **[P2, khoảng trống kiểm chứng] Tích hợp CLI chưa có adapter/kiểm thử đầy đủ cho từng agent.**
    Availability mới kiểm tra executable trên PATH. Model/API chủ yếu được truyền bằng các biến môi trường chung;
    chưa có bảng tương thích và validation provider theo agent, kiểm tra đăng nhập hoặc phiên bản CLI.
    Không thể suy ra cả 14 lựa chọn đều đã chạy hội thoại thật chỉ từ smoke test PowerShell.
    Mã: `src/main/command_check.js`, `src/renderer/launch_page.js:765`, `src/renderer/agents.js`.

## File và hiệu năng

13. **[P1, tái hiện] Preview giữ nội dung cũ sau khi file trên ổ đĩa thay đổi.**
    Mở file, thay nội dung từ bên ngoài, bấm mở lại: vẫn hiện nội dung cũ vì app chỉ focus pane sẵn có.
    Trong ứng dụng dùng AI sửa code, điều này khiến người dùng đánh giá sai kết quả mới nhất.
    Mã: `src/renderer/terminal_grid.js:1098`, `:1183`.

14. **[P2, tái hiện] Cây file không tự cập nhật khi agent tạo file.**
    File mới được tạo trên đĩa chưa xuất hiện cho đến khi Refresh/import. Chưa có watcher hoặc tự đồng bộ theo thay đổi.
    Mã: `src/renderer/file_panel.js:90`, `:395`.

15. **[P2, mã nguồn] Refresh/import làm mất trạng thái thư mục đang mở.**
    load_root_rebuild xóa cache và children_open; cây thư mục bị dựng lại từ gốc.
    Mã: `src/renderer/file_panel.js:90`.

16. **[P2, tái hiện] Import trên 100 mục bị cắt bớt âm thầm.**
    Gửi 101 file mẫu: chỉ có 100 kết quả thành công, không có kết quả/cảnh báo riêng cho mục thứ 101.
    Mã: `src/main/ipc_files.js:217`.

17. **[P2, mã nguồn/rủi ro] IO đồng bộ và thiếu progress/cancel cho tác vụ file lớn.**
    List/stat/read/copy chạy đồng bộ trong main process; copy thư mục dùng fs.cpSync.
    Tác vụ nặng có thể chặn main process, ảnh hưởng IPC/terminal/mobile. Chưa đo ngưỡng dung lượng gây chậm trên máy khác.
    Mã: `src/main/ipc_files.js:72`, `:132`, `:233`.

## Dữ liệu, ranh giới file và mobile

18. **[P1 trước public release, mã nguồn] API key lưu dạng JSON thuần.**
    providers.json chứa api_key trực tiếp, chưa dùng kho bí mật hệ điều hành.
    Mã: `src/main/providers_store.js:55`.

19. **[P2, tái hiện] Kiểm tra đường dẫn không ngăn junction trỏ ra ngoài workspace.**
    Trong fixture tạm, junction `<workspace>/linked-outside` trỏ sang thư mục khác;
    files.read đọc được file sentinel bên ngoài. Kiểm tra hiện tại chỉ xét đường dẫn chuỗi, chưa xét real path.
    Đây là lỗi so với ràng buộc workspace mà module mô tả; test không đọc dữ liệu cá nhân và không chứng minh tấn công từ xa.
    Mã: `src/main/ipc_files.js:47`, `:132`.

20. **[P2, mã nguồn] Desktop/mobile cùng thay đổi kích thước một PTY, thiếu cơ chế chủ sở hữu kích thước.**
    Cả hai giao diện gửi resize vào cùng terminal; chưa có hợp đồng chọn viewport nào điều khiển kích thước tiến trình.
    Có thể gây wrap/reflow không khớp giữa các màn hình. Chưa tái hiện bằng hai thiết bị vật lý.
    Mã: `src/main/mobile_server.js:428`, `src/main/ipc_terminals.js:20`.

21. **[P2, mã nguồn] Rate limit mobile khóa chung mọi kết nối mới.**
    Ba token sai khóa server 30 giây; người dùng có token đúng cũng không kết nối mới được trong khoảng này.
    Đây là giới hạn của thiết kế rate-limit chung, không phải vượt qua xác thực.
    Mã: `src/main/mobile_server.js:200`, `:205`, `:269`, `:325`.

22. **[Giới hạn vận hành, mã nguồn] Mobile dùng HTTP/WS và token trong URL.**
    Phù hợp mô hình LAN/VPN được README mô tả; chưa có hạ tầng HTTPS/identity cho dịch vụ remote công khai.
    Mã: `src/main/mobile_server.js:134`, `src/main/ipc_mobile.js:30`.

## Kiểm thử, đóng gói và phát hành

23. **[P1, chưa kết luận nguyên nhân] Một lượt smoke workbench timeout lúc cleanup/đóng phiên.**
    Lượt audit release trước chạy qua 25 kiểm tra rồi dừng ở giới hạn 120 giây; kiểm tra cuối chưa hoàn tất.
    Mobile test pass nhưng có log AttachConsole failed của helper node-pty khi teardown.
    Chưa đủ dữ liệu để kết luận lỗi native, lỗi lifecycle app hay lỗi test; cần điều tra và có regression test.

24. **[P1 trước phát hành, tái hiện bằng hash] Payload `app/` cũ hơn source/dist.**
    Source và dist chứa terminal_grid.js cùng hash, app/ khác hash. Installer đọc app/;
    nếu lấy bộ zip từ thư mục này có thể phân phối nhầm code cũ.
    Mã: `install.ps1:84`, `scripts/build_app.mjs`.

25. **[P2 trước stable, mã nguồn] Nâng cấp chưa có rollback nguyên khối.**
    Installer dùng robocopy /MIR trực tiếp vào bản cài; chưa stage bản mới + backup/swap/restore.
    Build payload cũng xóa app/ trước khi copy xong. Chưa test mất điện/thiếu dung lượng giữa copy.
    Mã: `install.ps1:115`, `scripts/build_app.mjs:20`.

26. **[Khoảng trống phát hành] Chưa có pipeline/tag/artifact và kênh tải hoàn chỉnh.**
    Checkout chưa có .github/workflows, CHANGELOG hay git tag. Bản exe kiểm tra chưa ký số;
    chưa có auto-updater, checksum/release notes tự sinh hay thông tin version/build trong UI.
    GitHub connector ở lượt audit release xác nhận repo đang private.
    Hiện chỉ có build Windows; macOS/Linux chưa được port/test để công bố hỗ trợ.

27. **[P3, tái hiện] npm run dev lỗi trên Windows.**
    Script gán env theo cú pháp Unix; chạy thực tế báo `'AGENT_HUB_DEVTOOLS' is not recognized`.
    Mã: `package.json:19`.

28. **[Thiếu tính năng/coverage] Preview và smoke test chưa đáp ứng toàn bộ trải nghiệm mục tiêu.**
    Chưa có editor/autosave/quick-open như hình tham khảo. Chưa kiểm thử trên Windows sạch,
    chạy nhiều CLI thật lâu dài, sleep/wake, mất mạng/đổi mạng, crash/recovery và nâng cấp giữa hai bản phát hành thật.
    Bộ test hiện còn khẳng định việc chuyển tab ẩn các pane khác là đúng: nó kiểm tra thiết kế đã viết,
    chưa kiểm tra yêu cầu mới về giữ bố cục cố định. Cần sửa tiêu chí chấp nhận cùng thiết kế tương tác.

## Thứ tự xử lý đề xuất

1. Chốt lại tương tác pane cố định, một vùng file có tab, kéo divider để resize; lưu split theo workspace.
2. Sửa lưu/khôi phục model/provider và metadata worktree; giữ phiên lỗi để retry.
3. Đồng bộ tree/preview theo đúng worktree; sửa drop path mapping và import feedback.
4. Điều tra teardown, kiểm tra chạy lâu, xử lý IO nặng và bảo vệ dữ liệu/API key.
5. Đóng gói từ một nguồn đã kiểm tra, bổ sung version/release pipeline và thử beta trên máy sạch.

## Bằng chứng và phạm vi

- `audit-workbench.cjs` / `audit-workbench-results.json`: renderer + main thật, terminal cmd ngắn hạn,
  repo/worktree/profile tạm; tái hiện click/zoom, resize rồi reload, preview cũ, file mới không xuất hiện,
  pane cao ~5 px và worktree restart báo cwd thiếu.
- `audit-files.cjs` / `audit-files-results.json`: file fixture tổng hợp, import 101 mục và session record mẫu.
- `release-readiness-2026-11-03.md`: kết quả cài mới/nâng cấp/gỡ, audit dependency và tình trạng phân phối.
- Không sửa code sản phẩm trong lượt rà này. Working tree main giữ sạch.
