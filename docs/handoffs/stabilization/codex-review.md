# Codex review và việc cần Grok sửa tiếp

- Ngày review: 03/11/2026, Asia/Saigon.
- Branch: `fix/workbench-stability`.
- Baseline: `94257b12aabe4dcb2ec48e1c2c6a74a37c71e1fa`.
- HEAD được review: `4edad8c880b1f0d23f0f15b2bb77fd0c42172b37`.
- Kết luận: **CHANGES_REQUESTED**, implementation **PARTIAL**, public release **NOT_READY**.
- Working tree đầu lượt sạch. Không push, tạo PR, merge, release hay đổi visibility.
- Lượt review chỉ bổ sung tài liệu, fixture kiểm chứng và evidence; không sửa implementation của Grok, không tạo commit.

Người dùng đã cho phép push/tạo PR nếu review đạt. Điều kiện đó chưa đạt vì có sáu lỗi tái hiện được dưới đây. Việc thiếu chứng chỉ hay thiết bị thật không phải lý do chính giữ branch local: hiện có lỗi chức năng và mất dữ liệu.

## Findings và yêu cầu sửa

### R1 — [P1] Autosave ghi đè file bằng phần preview bị cắt

**Code:** `src/renderer/terminal_grid.js:1275–1293`; `src/main/ipc_files.js:135–142,314–342`. Liên quan T13/T28a.

`read_file` chỉ đọc 512 KiB và trả `truncated:true`. Renderer vẫn tạo textarea có thể sửa, rồi autosave toàn bộ textarea bằng `write_text`. Nhãn “showing the first part” không bảo vệ phần file chưa được đọc.

**Tái hiện độc lập:** mở `large.txt` 614400 byte, thêm `EDIT`, đợi autosave. File trên đĩa chỉ còn **524292 byte**, mất 90112 byte nội dung gốc. Chỉ dùng file fixture tạm.

**Giao Grok:** preview bị cắt phải chỉ đọc, hoặc editor phải nạp đầy đủ nội dung trong giới hạn hỗ trợ trước khi cho sửa. Không coi một đoạn preview là toàn bộ tài liệu. Bảo vệ cả backend khi cần; không dùng cách nối đuôi mù vì không giữ được semantics edit/revision.

**Nghiệm thu:** file dưới/trên 512 KiB, UTF-8 nhiều byte tại boundary, file vượt giới hạn, read-only. Sửa hợp lệ không mất byte ở đuôi, BOM/line ending thuộc phạm vi hỗ trợ phải được giữ. Preview cắt không phát sinh write.

### R2 — [P1] Buffer conflict bị thay bằng nội dung đĩa khi đổi tab

**Code:** `src/renderer/terminal_grid.js:1223–1230,1265–1279,1334–1358`. Liên quan T13/T28a.

Mọi lần activate đều gọi reload; `load_file_content` đặt lại `file.mtime`, `file.disk` và textarea từ đĩa, bỏ qua `file.dirty`/`file.buffer`. Nhánh conflict báo “Your edits are still in the editor” nhưng không bảo toàn buffer khi chuyển tab. Timer save dùng chung cho cả pane và đóng tab cuối cũng cần được kiểm tra.

**Tái hiện độc lập:** sửa A thành `MY UNSAVED EDIT`, thay A từ bên ngoài thành `EXTERNAL DISK UPDATE`, đợi UI báo `conflict`, mở B rồi quay lại A. Editor hiện **EXTERNAL DISK UPDATE**, không còn bản sửa để người dùng xử lý.

**Giao Grok:** lưu buffer/revision/save state theo file, render lại buffer bẩn khi activate, chỉ refresh file sạch tự động. Có luồng xử lý conflict rõ ràng; giữ buffer qua lỗi và chặn discard ngoài ý muốn. Save dùng snapshot/version phù hợp để response cũ không đánh dấu edit mới là saved. Kiểm tra close tab/app trước debounce và timer giữa hai file.

**Nghiệm thu:** conflict → đổi tab → quay lại vẫn giữ edit; sửa A rồi B trong 600ms không hủy save A; đổi/đóng tab trước debounce không mất nội dung; gõ tiếp trong khi write đang chạy không báo saved sai; external update không bị ghi đè âm thầm.

### R3 — [P1] Sửa metadata provider xóa key legacy khi mã hóa không khả dụng

**Code:** `src/main/providers_store.js:151–155,194–215` và `to_disk`/`remove_provider`. Liên quan T05/T18.

Migration giữ `pending_plain` trong RAM khi codec unavailable. Tuy nhiên save metadata không có key mới vẫn đặt `pending_plain:''`, rồi `write_stored` bỏ hẳn key plaintext và không có ciphertext thay thế. Một thao tác remove/update provider khác cũng có thể serialize các legacy provider còn lại qua `to_disk`.

**Tái hiện độc lập:** provider legacy có fake key, codec inject `available:()=>false`, đổi tên không nhập key. Save **không reject**, record thành `secret_status:'empty'`, không còn key plaintext hoặc ciphertext. Đây là test module với codec giả lập điều kiện unavailable; không phải kiểm chứng safeStorage thật bị lỗi, không đọc credential thật.

**Giao Grok:** khi bất kỳ secret cần migration chưa được seal thành công, không được rewrite file làm mất nó. Fail nguyên thao tác có thông báo hoặc thiết kế transaction bảo toàn dữ liệu; không thêm fallback/backup plaintext. Áp dụng cho update/remove/create và toàn bộ provider trong file.

**Nghiệm thu:** unavailable, encrypt throw giữa nhiều provider, decrypt failure, sửa tên/xóa provider khác, relaunch/retry. Credential chưa migrate được phải được giữ nguyên trên file gốc; thay đổi thành công phải atomic và chỉ chứa ciphertext.

### R4 — [P2] Cold restore bỏ mất split 70/30

**Code:** `src/renderer/terminal_grid.js:709,1394–1460,2140–2205`. Liên quan T02/T04.

`apply_saved_layout` chỉ chạy trong attach live terminals. Khi app vừa khởi động và chưa có live pane, không có leaf để ghép. Saved sessions được mount sau đó nhưng không apply lại tree. Record ID mới sau restore cũng không khớp key cũ. Nhóm file được mở sau apply nên cần xử lý cùng vòng đời restore.

**Tái hiện độc lập:** seed hai saved session hợp lệ và tree có record keys tương ứng, sizes `[0.7,0.3]`, không có live PTY; tạo view và gọi restore theo luồng app. Hai pane được phục hồi nhưng widths **465.2/465.2**, tức **50/50**. Đây là fixture cold-restore cùng process, không phải bằng chứng đã relaunch executable hai lần.

**Giao Grok:** có identity layout ổn định hoặc mapping old/new ID; apply tree sau khi tập terminal/file panes cần thiết đã sẵn sàng. Không ghi đè saved tree bằng cây đang restore dở. Giữ root identity và xử lý file/session bị thiếu rõ ràng.

**Nghiệm thu:** đóng/mở app thật với 2/4/6 pane, split 70/30, có/không nhóm file; hai workspace có layout khác nhau. Test renderer reload còn live PTY phải tách khỏi test app restart.

### R5 — [P2] Click trong terminal không đổi explorer sang worktree đang chọn

**Code:** `src/renderer/terminal_grid.js:982,1941–1975`. Liên quan T10/T11/T28b.

Mousedown của pane gọi `set_active_pane`, nhưng chỉ `select_tab` gọi `sync_file_context`. Click trực tiếp trong terminal là đường chọn pane thông thường, nên focus agent và root explorer có thể lệch nhau.

**Tái hiện độc lập:** tạo terminal với git worktree thật, dispatch mousedown vào pane đó. `.fp-title.title` vẫn trỏ repo gốc, không phải `workspace.worktrees/<branch>`. Người dùng có thể mở/sửa file ở repo gốc dù đang làm việc trong agent worktree.

**Giao Grok:** đồng bộ context qua một đường chọn/focus pane dùng cho chuột, bàn phím và sidebar; không thay geometry. File tabs phải giữ root của chính file. Rà quick-open vì event listeners hiện capture `root` từ lần tạo overlay đầu tiên; đổi context phải dùng root hiện tại.

**Nghiệm thu:** repo gốc + hai worktree có `src/foo.js` khác nhau; click thân terminal/tab/sidebar, Ctrl+Tab; tree/editor/quick-open/Open/Reveal trỏ đúng root và vẫn giữ bounds terminal.

### R6 — [P2] Restart sau process exit làm mất worktree metadata ở main và saved record

**Code:** `src/renderer/terminal_grid.js:2225–2236`; `src/main/pty_manager.js:200,215–217,318`. Liên quan T06/T07.

Process exit xóa saved record. Restart truyền `restore_record_id` của record đã bị xóa, `use_worktree:false`, nên main không có nguồn lấy worktree metadata. Renderer giữ giá trị cũ bằng fallback làm lỗi khó thấy trước lần reload.

**Tái hiện độc lập:** terminal trong worktree thật → nhập `exit` → bấm Restart. `cwd` vẫn đúng, nhưng cả `pty.list_terminals()` và `sessions.json` của terminal mới đều có **worktree:null**. Điều này mất branch/repo identity qua reload/restore và làm đường cleanup worktree không còn biết terminal sở hữu worktree nào.

**Giao Grok:** bảo toàn context main-owned trước khi gỡ session/record, hoặc giữ record có lifecycle trạng thái exited để restart có thể resolve. Không tin một worktree object tùy ý từ renderer thay cho kiểm chứng main. Giữ nguyên worktree hiện tại thay vì tạo mới để che lỗi.

**Nghiệm thu:** exit/restart với worktree sạch và bẩn; so sánh path/branch/repo/base_commit trong main và disk; renderer reload + app relaunch sau restart; close chỉ dọn worktree thuộc quyền sở hữu và sạch, không xóa worktree bẩn.

## Kiểm chứng đã chạy

Môi trường: Windows x64 tại workspace của người dùng; Node v24.11.1, npm 11.6.3, Electron 44.9.0. Profile, git repo, file, worktree và fake key trong regression đều là fixture tạm.

| Lệnh | Kết quả review độc lập |
| --- | --- |
| `npm run check` | Exit 0, 18 PASS; kiểm tra legacy preset trong script chỉ đọc fixture rồi so string, không gọi store normalizer |
| `node node_modules/electron/cli.js scripts/smoke_workbench.js` | Exit 0, all checks passed |
| `node node_modules/electron/cli.js scripts/smoke_mobile.js` | Exit 0, all checks passed |
| `node node_modules/electron/cli.js scripts/lifecycle_cycles.js` | Exit 0, 20 cycle PASS, live 0; không phải soak/restart/reload đầy đủ |
| `node --check` cho toàn bộ JS/MJS thay đổi và fixture review mới | PASS |
| `git diff --check` | PASS tại thời điểm kiểm tra |
| `node node_modules/electron/cli.js scripts/codex_review_regressions.js` | **Exit 1, R1–R6 đều FAIL**, không có harness error |

Evidence mới: `docs/handoffs/stabilization/evidence/codex-review-regressions.json`. Fixture mới: `scripts/codex_review_regressions.js`. Không sửa evidence audit cũ để làm thành PASS.

Không chạy build/package/install/upgrade/uninstall, 30 phút soak, Windows sạch, CLI/provider/auth thật, safeStorage failure thật, phone/LAN/VPN/sleep-wake hay remote CI trong review này. Các smoke PASS không thay thế các nghiệm thu đó. Không có ảnh UI mới.

## Ma trận reviewer

VERIFIED chỉ dùng cho phạm vi đủ bằng chứng; PARTIAL nghĩa là có code/kiểm tra một phần, chưa đạt toàn bộ nghiệm thu. FAILED có lỗi độc lập ở trên. Không đổi nhãn triển khai gốc của Grok thành PASS.

| ID | Kết luận reviewer | Bằng chứng / phần còn thiếu |
| --- | --- | --- |
| T01 | PARTIAL | Focus/double-click và bounds pass ở smoke hiện có; chưa đủ 2/4/6 pane + legacy profile |
| T02 | FAILED | R4: cold restore mất ratio; file tabs/selection qua relaunch chưa đủ |
| T03 | PARTIAL | Một nhóm file với text/image pass; chưa 20 file/overlap |
| T04 | PARTIAL | Files visibility khác workspace pass; split persistence chưa đạt R4 |
| T05 | PARTIAL | IDs/secret stripping Node pass; model/provider qua CLI và relaunch chưa test, migration có R3 |
| T06 | FAILED | R6: mất worktree metadata sau exit/restart |
| T07 | PARTIAL | Code giữ lỗi restore và có Forget; missing folder/CLI rồi Retry chưa test; cần rà R6 |
| T08 | PARTIAL | Capability chỉ nhận Claude conversation; chưa hội thoại/resume thật. Rà đường session ID qua exit/restart, không tự báo verified |
| T09 | PARTIAL | Store seat object có code; legacy preset test không kiểm normalizer; save/load/relaunch lineup chưa test |
| T10 | FAILED | R5: chọn trực tiếp pane để explorer ở root cũ |
| T11 | PARTIAL | Smoke drop target/worktree/external pass; root focus R5, file có dấu/quotes và target-close race chưa đủ |
| T12 | PARTIAL | 14 IDs khớp capability; phần lớn model/provider/resume chưa hỗ trợ/verified. UI vẫn có lựa chọn cần đối chiếu với main rejection; CLI thật NOT_RUN |
| T13 | FAILED | R1/R2: editor cắt file và mất buffer conflict |
| T14 | PARTIAL | Có watcher/debounce/ignore code; burst và dispose qua nhiều root chưa đo |
| T15 | PARTIAL | Có refresh preserve code; mở ba tầng/relaunch/root switch chưa kiểm chứng |
| T16 | PARTIAL | 101/250 có kết quả/reject toàn batch pass Node; UI accounting/cancel/collision chưa đầy đủ |
| T17 | PARTIAL | Copy/list/search async; read/path canonicalization còn sync; progress/cancel UI và event-loop latency chưa nghiệm thu |
| T18 | FAILED | R3: migration unavailable + metadata edit xóa key |
| T19 | PARTIAL | Junction-outside read reject pass; chưa toàn bộ write/preview/Open/Reveal/import/in-root link/UNC matrix |
| T20 | PARTIAL | Có desktop owner code; smoke mobile không assert dimension arbitration với 2 client + desktop |
| T21 | PARTIAL | Node A lock/B không lock và HTTP wrong-token lock pass; rotate/expiry/HTTP+WS hai nguồn chưa đủ |
| T22 | PARTIAL | Scope text LAN/loopback, no-store/no-referrer code; auth loopback smoke pass; LAN/VPN thật NOT_RUN |
| T23 | PARTIAL | 20 create/close và 2 smoke exit 0; root cause crash lần trước chưa đủ evidence, multi-pane restart/reload/resource/30-minute soak chưa chạy |
| T24 | PARTIAL | Stage/swap và manifest có code; chưa pipeline source→dist→app/build provenance. Script hiện lấy commit hiện tại rồi stamp payload đã tồn tại, chưa chứng minh payload tương ứng commit |
| T25 | PARTIAL | Stage/swap/rollback có code; install/upgrade/uninstall và failure injection NOT_RUN |
| T26a | PARTIAL | Version UI/CHANGELOG/manifest code; artifact provenance/version thực tế chưa xác nhận |
| T26b | PARTIAL | Workflow chỉ manual, quyền contents:read; remote CI NOT_RUN, thiếu build/artifact validation trong workflow hiện tại |
| T26c | NOT_RUN | Chưa có gói release/checksum mới, chưa chọn kênh tải; không publish |
| T26d | BLOCKED | Grok báo không có signing certificate; review không kiểm tra credential/signing thật |
| T26e | PARTIAL | Chỉ manual update; chưa integrity/signature/rollback end-to-end, không có updater production |
| T26f | PARTIAL | Phạm vi Windows x64 được ghi; clean-machine artifact NOT_RUN |
| T27 | PARTIAL | Runner dev mới syntax hợp lệ; không rerun npm dev/start/packaged app trong review này |
| T28a | FAILED | R1/R2, thêm R5 cho đúng root |
| T28b | PARTIAL | Có search/overlay code; quick-open context/root cần kiểm theo R5, keyboard navigation chưa nghiệm thu |
| T28c | FAILED | Smoke pass nhưng bỏ sót cả sáu regression; thêm fixture review có exit nonzero thật |
| T28d | NOT_RUN | Windows sạch, artifact upgrade, Vietnamese path, rollback chưa chạy |
| T28e | NOT_RUN | CLI/auth/provider/phone/LAN/VPN/sleep-wake/crash/soak thật chưa chạy |

## Prompt giao lại Grok

Tiếp tục trên `fix/workbench-stability` từ HEAD review `4edad8c`. Đọc báo cáo này, `stabilization-tasks.md` và `stabilization-results.md`. Giữ các file review mới trong working tree, không reset/clean hay sửa evidence FAIL lịch sử để che lỗi.

1. Sửa R1/R2/R3 trước vì mất dữ liệu; tiếp tục R4/R5/R6. Mỗi lỗi cần regression có ý nghĩa, giữ test kiểm hành vi người dùng; không mock bỏ đường lỗi, bỏ assertion, sửa expectation sai thành đúng hay tăng timeout để đạt PASS.
2. Chạy fixture review R1–R6; sau sửa tất cả phải pass và exit 0. Không ghi đè evidence gốc của review này để mô tả lại quá khứ. Harness giữ file evidence đầu tiên và ghi file có SHA/timestamp riêng ở các lượt chạy tiếp theo.
3. Rà toàn bộ các hàng PARTIAL, đặc biệt CLI model/provider tương thích UI/main, Claude session ID qua restart, progress/cancel import, watcher dispose, stale payload/manifest. Không tự thu hẹp requirement chưa xong để báo hoàn tất. Mỗi điểm còn thiếu phải có status và cách test rõ ràng.
4. Chạy lại Node check, workbench/mobile smoke, lifecycle; bổ sung cold relaunch, dirty buffer/conflict và real worktree exit/restart/reload. Build/package + sandbox install/upgrade/rollback chỉ trên fixture đúng ownership. Soak/real integration thiếu điều kiện giữ NOT_RUN/BLOCKED, không giả PASS.
5. Local commits riêng dễ review; cập nhật kết quả gắn base/head mới và evidence. Không push/merge/PR/tag/release/deploy trong lượt sửa này. Bàn giao lại để Codex review; người dùng đã cho Codex push/tạo PR khi kết quả thực sự đạt.

Không có kênh Grok trực tiếp trong phiên Codex này; đây là gói công việc để đưa vào phiên Grok đang thực hiện, không phải xác nhận Grok đã nhận/chạy việc.
