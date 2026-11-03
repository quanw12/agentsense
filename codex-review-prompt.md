# Prompt review sau khi Grok bàn giao

Hãy review và kiểm chứng thay đổi local của Grok cho AgentSense theo:

- `stabilization-tasks.md`: hợp đồng T01–T28.
- `stabilization-results.md`: bằng chứng người thực hiện đã ghi.
- `docs/handoffs/stabilization/audit.md`: phát hiện trước sửa, không phải kết quả hiện tại.

Chỉ review/kiểm chứng trong lượt này. **Không push, merge, tạo PR, tag, release, deploy hoặc đổi visibility**,
kể cả khi review không còn findings. Kết luận APPROVED_FOR_PUSH là kết quả review, không tự thực hiện push.

## Trình tự

1. Đọc hướng dẫn repo, git status, branch, base/head SHA và local commits. Không reset/clean/ghi đè thay đổi.
   Xác minh base SHA thật; baseline audit cũ `94257b12aabe4dcb2ec48e1c2c6a74a37c71e1fa` chỉ là mốc tham khảo.
2. Đọc diff và các đường gọi liên quan, không chỉ dựa vào tóm tắt hoặc nhãn FIXED_VERIFIED của Grok.
   Kiểm tra cả thay đổi chưa commit và các file mới. Không chạy script mới trước khi đọc để hiểu tác động.
3. Review từng T01–T28 và subtask T26/T28. Mỗi mục ghi kết luận reviewer riêng: VERIFIED / PARTIAL /
   FAILED / NOT_RUN / BLOCKED. Kiểm tra migration, backwards compatibility và nguy cơ mất dữ liệu.
4. Tái hiện độc lập trên fixture/profile/repo/worktree tạm. Không dừng/đọc transcript/đổi dữ liệu agent thật.
5. Ưu tiên kiểm chứng: click chỉ đổi focus và không đổi bounds; divider resize + restore;
   một vùng file có tab; model/provider đúng qua restart; worktree không bị xóa sai;
   preview/editor đúng root và nội dung; conflict-safe save; không lộ secret; junction boundary;
   target drop đúng; cleanup/native lifecycle; source/dist/payload cùng build.
6. Đọc và chạy các regression/smoke có ý nghĩa. Kiểm tra không có mock/suppress/tăng timeout che lỗi,
   test chỉ kiểm tra implementation hoặc giữ expectation UX cũ. Xác minh deadline/teardown và test thất bại thật sự làm exit nonzero.
7. Kiểm tra bằng chứng clean-machine/real CLI/provider/device/soak: nguồn, ngày, versions và kết quả.
   Không biến kết quả mock hoặc thiếu thiết bị/tài khoản thành PASS. Thiếu signing/public hosting không được ghi đã phát hành.
8. Kiểm tra installer, rollback, permission, artifact manifest và dữ liệu đi kèm mà không thực hiện publication.

## Bàn giao review

- Findings theo mức ảnh hưởng, kèm file/dòng hiện tại, trigger, tác động và cách xác minh.
- Ma trận reviewer đầy đủ T01–T28 + subtask, chỉ rõ phần Grok báo xong nhưng chưa đủ bằng chứng.
- Lệnh đã chạy, kết quả, môi trường và các giới hạn.
- Kết luận riêng: chất lượng code local; phạm vi được kiểm chứng; khả năng public release.
- Cập nhật phần dành cho Codex trong `stabilization-results.md`, nêu HEAD nào đã được review.
- Đặt CHANGES_REQUESTED nếu còn regression/lỗi hoặc báo cáo sai trạng thái.
  Chỉ đặt APPROVED_FOR_PUSH khi code phù hợp phạm vi đã thống nhất và mọi thiếu sót còn lại được nêu rõ,
  không che một requirement chưa hoàn tất. Requirement chức năng còn lỗi phải ghi CHANGES_REQUESTED/PARTIAL,
  không tự bỏ khỏi scope để approve. APPROVED_FOR_PUSH không đồng nghĩa APPROVED_FOR_PUBLIC_RELEASE.
- Dừng ở kết luận review; không tự push hoặc phát hành.
