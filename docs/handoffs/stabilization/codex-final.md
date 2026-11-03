# Codex — sửa cuối và xác nhận trước push

Ngày 03/11/2026, Asia/Saigon. Branch `fix/workbench-stability`, bắt đầu từ `a93c76d4f5b785044f470196379e083929d7649a`. Người dùng đã yêu cầu Codex tự sửa phần còn lỗi, commit và push; quyền tạo PR từ yêu cầu trước vẫn còn hiệu lực. Không merge hoặc phát hành.

Commit runtime cuối: `332b6ed968cc9e2e91adb021ad035fba3dafede5`. Commit build/CI/evidence theo sau không thay runtime đã kiểm chứng.

**VERIFIED_FOR_PR trong phạm vi sửa/workflows đã kiểm chứng dưới đây. PUBLIC_RELEASE_READINESS vẫn NOT_READY.** Các hàng PARTIAL/NOT_RUN của ma trận ban đầu không tự trở thành VERIFIED.

## Thay đổi cuối

- Xác nhận race của global `ptyHandles` trong native node-pty 1.1.0 vẫn gây crash dù đã vá JS. Pin bản upstream **1.2.0-beta.17** chứa mutex fix [#922](https://github.com/microsoft/node-pty/pull/922), được mô tả ở [issue #921](https://github.com/microsoft/node-pty/issues/921) và [release notes](https://github.com/microsoft/node-pty/releases/tag/v1.2.0-beta.13). Đây là dependency prerelease được pin chính xác, không tuyên bố stable. Không sửa binary/native code thủ công trong node_modules.
- Giữ cơ chế đợi watcher/worker, xử lý kết nối async của node-pty mới, không trả terminal ready với PID 0. Cleanup launch thất bại; các lệnh close đồng thời dùng chung promise chứa cả native cleanup và worktree handling.
- Shutdown chặn admission trước, đợi các launch đã nhận rồi dọn hết terminal. Main đồng thời dừng mobile/hook listeners và đợi cleanup trước khi quit. Production lifecycle dùng trace buffer thay cho in PID liên tục ra console.
- Main resolve Claude resume ID từ saved record khi Restart không gửi ID; mock executable đã kiểm argv `--resume <saved-id>`, không dùng Claude/auth thật.
- Editor serialize theo CRLF của file gốc và giữ BOM. Mixed/legacy line endings hoặc byte không phải UTF-8 chỉ đọc với thông báo; không âm thầm chuẩn hóa dữ liệu. Test UI thật thay vì chỉ test backend với chuỗi CRLF có sẵn.
- `npm run build:app` luôn chạy electron-builder trước, đối chiếu source/JS/native files và version dependency với bản đã test, ghi hash/version/dirty flag rồi stage/swap. Dependency package metadata được builder normalize nên kiểm version trước rồi hash metadata đã đóng gói; debug/linker artifacts không phải runtime không đưa vào yêu cầu so sánh.
- Installer kiểm BUILD.json, exe và resource checksums trước swap; từ chối cả APPDATA root, không recursive-remove thư mục mới dự kiến rỗng. Sandbox upgrade hỏng giữ nguyên bản cài cũ.
- CI pull_request quyền contents:read chạy Node/PTY/editor regressions, repeated native suites, build và sandbox installer. Chưa coi remote CI là đã chạy trước push/PR.

## Kiểm chứng

Môi trường Windows x64, Node launcher v26.13.0, Electron 44.9.0, node-pty 1.2.0-beta.17. CI dùng Node 24. Tất cả fixture/profile/repo/worktree/shortcut nằm trong vùng tạm; không sửa profile hay transcript thật.

| Kiểm tra | Kết quả |
| --- | --- |
| `npm run check` | 27 PASS, exit 0 |
| R1–R6 | PASS; R1 phải đợi save hoàn tất và so toàn bộ nội dung, R2 phải thật sự ở trạng thái conflict |
| R7/R8, R9, R10 | PASS; Discard không có stale write, conflict chặn close, normal close flush file |
| `npm run check:pty` | PASS: bốn final-output cases, bốn natural exits đồng thời, resume argv mock, concurrent close, child process cleanup, shutdown admission/in-flight launch |
| `scripts/check_editor_format.js` | PASS: UI autosave giữ BOM/CRLF, mixed lines và invalid UTF-8 read-only/byte-identical |
| `npm run check:stability` | **12/12 PASS**: 4 workbench + 4 mobile + 4 native main.js product quit, tất cả process exit 0, không timeout/orphan |
| `scripts/lifecycle_cycles.js` | 20/20 PASS, live 0, exit 0 |
| Packaged resources + native main shutdown | PASS, exit 0, orphans [] |
| Build/source/native hash verification | PASS; verify source and actual tested native runtime dependencies before app/ replacement |
| Sandbox install/reinstall/corrupt upgrade/uninstall | PASS; bad upgrade rejected before replacing the old exe, unrelated sentinel unchanged |
| JS/MJS syntax, `git diff --check` | PASS |
| `npm audit --omit=dev` | 0 reported vulnerabilities; does not cover dev tooling or constitute a full security audit |

Native evidence chính: `evidence/final-release-check/results.json` và log 12 process. File ghi SHA256 của main.js, pty_manager.js và package.json; đã đối chiếu khớp runtime cuối. `evidence/final-verified` là lượt 12/12 trước đó. Sandbox mới dùng `evidence/final-install-upstream.json`. Các JSON regression mới gắn parent `a93c76d` vì chạy trên working tree trước commit, không giả đó là nội dung commit gốc; bản cuối được gắn bởi source hashes và commit sắp tạo.

## Những failure giữ trong lịch sử và cách xử lý

- `final-native-pass/workbench-3.log` ghi crash 0xC0000005 trước khi nâng dependency. Không coi vá JS của bản cũ đã giải quyết mutex race.
- Một số lượt workbench do launcher ẩn window chưa có font-cell metrics. Fixture chủ động show window và chờ đúng fit state, không tăng deadline để che lỗi.
- Khi window thực sự render, PowerShell gửi CPR/focus replies vào các terminal khác. Diagnostic xác nhận `ESC[5;1R` và `ESC[I`, không phải input drop. Assertion chỉ loại đúng các protocol replies này, vẫn yêu cầu path đúng target và không newline.
- Ctrl+C/exit vào shell chứa path paste chưa Enter không phải protocol teardown tin cậy. Smoke dùng product close API và kiểm cleanup. Natural concurrent exit vẫn có test riêng với bốn shell sạch, không bỏ coverage native exit.
- Build validation ban đầu bắt khác biệt metadata do electron-builder normalize package.json và debug PDB bị loại. Chính sách cuối kiểm metadata/version tương ứng và mọi file runtime cần thiết, không đòi debug artifacts. Bản app/ cũ được giữ khi verify thất bại.
- Lượt installer đầu bị execution policy chặn, không tính PASS. Fixture cuối dùng process riêng với cùng `-ExecutionPolicy Bypass` như launcher repo, không đổi policy máy; asserts kiểm exe/shortcut/exit thực tế.

## Giới hạn còn công bố

Chưa chạy 30-minute soak, Windows sạch/tài khoản khác, hội thoại/auth/provider/phone/LAN/VPN thật, sleep/wake và upgrade giữa hai phiên bản artifact khác nhau. Sandbox reinstall/rollback cùng artifact không thay thế toàn bộ T25/T28d. Signing và auto-update production chưa có. Các CLI/model/provider adapters còn giới hạn theo capability matrix. Bản build local unsigned; không phát hành hoặc đổi visibility. Những giới hạn này được nêu trong PR, không ghi toàn bộ T01–T28 hoàn tất.
