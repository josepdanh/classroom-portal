const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const LOCAL_CREDENTIALS_FILE = path.join(__dirname, 'google-credentials.json');
const ROOT_DRIVE_LOCAL = '/Users/Danh/Library/CloudStorage/GoogleDrive-josepdanh@gmail.com/Drive của tôi/EduClass_BaiTap';
const UPLOADS_DIR = path.join(__dirname, 'uploads');

async function syncDriveFiles() {
  console.log('🔄 Đang bắt đầu kiểm tra và đồng bộ file học sinh từ Google Drive về máy Mac...');

  if (!fs.existsSync(LOCAL_CREDENTIALS_FILE)) {
    console.error('❌ Không tìm thấy file google-credentials.json.');
    return;
  }

  const credentials = JSON.parse(fs.readFileSync(LOCAL_CREDENTIALS_FILE, 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive']
  });
  const drive = google.drive({ version: 'v3', auth });

  try {
    // 1. Lấy danh sách tất cả file (không phải thư mục)
    const res = await drive.files.list({
      q: "mimeType != 'application/vnd.google-apps.folder' and trashed = false",
      fields: 'files(id, name, mimeType, parents, size)',
      pageSize: 100
    });

    const files = res.data.files || [];
    if (files.length === 0) {
      console.log('ℹ️ Hiện chưa có file bài nộp nào trên Google Drive.');
      return;
    }

    console.log(`📋 Tìm thấy ${files.length} file bài tập trên Google Drive:`);

    let downloadedCount = 0;
    let existingCount = 0;

    for (const f of files) {
      // Tìm thư mục cha để biết Lớp và Môn
      let destDir = ROOT_DRIVE_LOCAL;
      if (f.parents && f.parents.length > 0) {
        try {
          const parentRes = await drive.files.get({
            fileId: f.parents[0],
            fields: 'id, name, parents'
          });
          const subjectName = parentRes.data.name;

          let className = '';
          if (parentRes.data.parents && parentRes.data.parents.length > 0) {
            const grandParentRes = await drive.files.get({
              fileId: parentRes.data.parents[0],
              fields: 'id, name'
            });
            className = grandParentRes.data.name;
          }

          if (className && subjectName) {
            destDir = path.join(ROOT_DRIVE_LOCAL, className, subjectName);
          } else if (subjectName) {
            destDir = path.join(ROOT_DRIVE_LOCAL, subjectName);
          }
        } catch (e) {}
      }

      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const localPath = path.join(destDir, f.name);
      const projectUploadPath = path.join(UPLOADS_DIR, f.name);

      if (fs.existsSync(localPath)) {
        console.log(`  ✓ Đã có sẵn trên Mac: ${f.name}`);
        existingCount++;
      } else {
        console.log(`  ⬇️ Đang tải về: ${f.name}...`);
        const dest = fs.createWriteStream(localPath);
        const driveStream = await drive.files.get(
          { fileId: f.id, alt: 'media' },
          { responseType: 'stream' }
        );

        await new Promise((resolve, reject) => {
          driveStream.data
            .pipe(dest)
            .on('finish', () => {
              // Copy thêm bản vào thư mục uploads của dự án nếu cần
              try {
                fs.copyFileSync(localPath, projectUploadPath);
              } catch (e) {}
              resolve();
            })
            .on('error', reject);
        });

        console.log(`  ✅ Đã tải thành công: ${f.name}`);
        downloadedCount++;
      }
    }

    console.log('\n=======================================================');
    console.log(`🎉 HOÀN TẤT ĐỒNG BỘ:`);
    console.log(`- File mới tải về: ${downloadedCount}`);
    console.log(`- File đã có sẵn: ${existingCount}`);
    console.log(`- Thư mục lưu trữ trên Mac:`);
    console.log(`  📁 ${ROOT_DRIVE_LOCAL}`);
    console.log('=======================================================');
  } catch (err) {
    console.error('❌ Lỗi trong quá trình đồng bộ từ Google Drive:', err.message);
  }
}

syncDriveFiles();
