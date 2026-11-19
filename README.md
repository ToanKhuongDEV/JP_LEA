# Nhật ký từ vựng

Web tĩnh học từ tiếng Nhật, lưu dữ liệu riêng của người dùng trong Google Drive. Không cần backend hoặc database.

## Cấu hình

1. Tạo project trong Google Cloud Console, bật Google Drive API.
2. Cấu hình OAuth consent screen, chọn đối tượng phù hợp, thêm tài khoản thử nghiệm nếu ứng dụng đang ở chế độ Testing. Thêm scope `https://www.googleapis.com/auth/drive.appdata`.
3. Tạo OAuth client loại Web application. Thêm origin triển khai (ví dụ `https://ten-ban.github.io`) vào Authorized JavaScript origins. Để thử trên máy, thêm `http://localhost` và `http://localhost:8000`.
4. Với GitHub Pages, vào Settings → Secrets and variables → Actions → Variables, tạo repository variable `GOOGLE_CLIENT_ID` chứa Client ID (không phải client secret), rồi chạy lại workflow deploy. Client ID vẫn hiển thị trong mã web. Để thử trên máy, điền Client ID vào `config.js` và tránh commit thay đổi đó nếu không muốn lưu trong Git.
5. Chạy `python -m http.server 8000` trong thư mục này, mở http://localhost:8000. Hoặc đưa toàn bộ file lên hosting tĩnh HTTPS như GitHub Pages.

Người dùng phải bấm đăng nhập và cấp quyền; ứng dụng sẽ tải dữ liệu từ Drive. Sau mỗi thay đổi, trạng thái lưu xuất hiện trên màn hình. Chỉ đóng trang sau khi đã lưu xong. Nếu lưu thất bại, nhấn thử lại hoặc tải bản sao JSON để giữ dữ liệu.

Dữ liệu nằm trong appDataFolder ẩn của ứng dụng, không phải file có thể thấy trong giao diện Drive. Xóa dữ liệu ứng dụng trong Drive cũng xóa dữ liệu này. Có thể nhập bản sao JSON bằng nút Nhập bản sao; thao tác này thay thế danh sách hiện tại sau khi xác nhận.

Hạn chế: Chỉ sửa trên một thiết bị tại một thời điểm. Kiểm tra phiên bản giúp phát hiện một số xung đột nhưng không đảm bảo tránh ghi đè nếu hai thiết bị lưu cùng lúc. Không nên dùng ứng dụng khi chưa cấu hình và kiểm thử OAuth thực tế.

Google: https://developers.google.com/workspace/drive/api/guides/appdata và https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid



Để bổ sung từ mà vẫn giữ danh sách hiện tại, chọn **Nhập thêm từ JSON** trong mục Từ vựng rồi chọn file cùng định dạng với `hiragana.json` hoặc bản sao đã tải. Nhóm trùng tên được dùng lại; từ có ID đã tồn tại được bỏ qua. File cần có `version: 1`, mảng `groups` (mỗi nhóm có `id`, `name`) và mảng `words` (mỗi từ có `id`, `japanese`, `romaji`, `meaning`, `groups` chứa ID nhóm trong file).

## Learning Together với Google Sheets

Đây là khu vực từ vựng chung ngay trên website, không cần đăng nhập, độc lập với dữ liệu Google Drive cá nhân. Tạo một **bảng tính Google Sheets mới, riêng cho ứng dụng**; không dùng bảng chứa dữ liệu quan trọng khác.

1. Trong bảng tính chọn **Tiện ích mở rộng → Apps Script**. Thay nội dung `Code.gs` bằng file [together/Code.gs](together/Code.gs) của dự án.
2. Thêm file HTML tên `Bridge`, sao chép toàn bộ [together/Bridge.html](together/Bridge.html) vào đó và lưu dự án. Nếu muốn giữ đường dẫn web app độc lập cũ, giữ cả file `Index`.
3. Chọn hàm `setup` và chạy một lần trong trình chỉnh sửa Apps Script; cấp quyền cho tài khoản chủ bảng. Hàm tạo trang `LearningTogether`; không chỉnh sửa trực tiếp các ô trong trang này.
4. Chọn **Triển khai → Lần triển khai mới → Ứng dụng web**, đặt **Thực thi dưới quyền: Tôi**, **Người có quyền truy cập: Mọi người**. Sao chép URL triển khai kết thúc bằng `/exec`.
5. Để hiện liên kết Learning Together trên GitHub Pages, tạo repository variable `TOGETHER_URL` chứa URL đó rồi chạy lại workflow deploy. Khi chạy tại máy, đặt URL vào `TOGETHER_URL` trong `config.js`.

Với bản triển khai Apps Script đã có, cập nhật `Code.gs`, thêm `Bridge`, rồi vào **Triển khai → Quản lý các tùy chọn triển khai → Chỉnh sửa**, chọn **Phiên bản mới** và triển khai. Không chạy lại `setup`: dữ liệu chung hiện có được giữ lại. Sau đó cập nhật website GitHub Pages. Giao diện Learning Together trên website dùng chung mã giao diện với khu vực cá nhân.

Mọi người có URL đều có thể đọc, thêm, sửa và xóa dữ liệu chung; đường dẫn không phải mật khẩu. Hãy chỉ lưu nội dung công khai và sao lưu thường xuyên bằng nút tải bản sao. Khi hai người cùng sửa, bản lưu cũ bị từ chối: tải bản sao để giữ thay đổi rồi tải lại trang trước khi sửa tiếp. Google áp dụng [hạn mức Apps Script](https://developers.google.com/apps-script/guides/services/quotas); dữ liệu chung được giới hạn khoảng 3 triệu ký tự. Bảng tính lưu dữ liệu ở dạng JSON chia thành nhiều ô, không phải bảng từ vựng có thể sửa trực tiếp.
