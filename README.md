# Nhật ký từ vựng

Web tĩnh học từ tiếng Nhật, lưu dữ liệu riêng của người dùng trong Google Drive. Không cần backend hoặc database.

## Cấu hình

1. Tạo project trong Google Cloud Console, bật Google Drive API.
2. Cấu hình OAuth consent screen, chọn đối tượng phù hợp, thêm tài khoản thử nghiệm nếu ứng dụng đang ở chế độ Testing. Thêm scope `https://www.googleapis.com/auth/drive.appdata`.
3. Tạo OAuth client loại Web application. Thêm origin triển khai (ví dụ `https://ten-ban.github.io`) vào Authorized JavaScript origins. Để thử trên máy, thêm `http://localhost` và `http://localhost:8000`.
4. Điền Client ID (không phải client secret) vào `config.js`. Client ID không phải bí mật và có thể nằm trong mã web.
5. Chạy `python -m http.server 8000` trong thư mục này, mở http://localhost:8000. Hoặc đưa toàn bộ file lên hosting tĩnh HTTPS như GitHub Pages.

Người dùng phải bấm đăng nhập và cấp quyền; ứng dụng sẽ tải dữ liệu từ Drive. Sau mỗi thay đổi, trạng thái lưu xuất hiện trên màn hình. Chỉ đóng trang sau khi đã lưu xong. Nếu lưu thất bại, nhấn thử lại hoặc tải bản sao JSON để giữ dữ liệu.

Dữ liệu nằm trong appDataFolder ẩn của ứng dụng, không phải file có thể thấy trong giao diện Drive. Xóa dữ liệu ứng dụng trong Drive cũng xóa dữ liệu này. Có thể nhập bản sao JSON bằng nút Nhập bản sao; thao tác này thay thế danh sách hiện tại sau khi xác nhận.

Hạn chế: Chỉ sửa trên một thiết bị tại một thời điểm. Kiểm tra phiên bản giúp phát hiện một số xung đột nhưng không đảm bảo tránh ghi đè nếu hai thiết bị lưu cùng lúc. Không nên dùng ứng dụng khi chưa cấu hình và kiểm thử OAuth thực tế.

Google: https://developers.google.com/workspace/drive/api/guides/appdata và https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid

