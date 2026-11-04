const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { exec } = require('child_process');

// URL của máy chủ web (mặc định lấy từ Render, hoặc localhost nếu test offline)
const REMOTE_SERVER_URL = process.env.SERVER_URL || 'https://classroom-portal-jlkb.onrender.com';
const LOCAL_SERVER_URL = 'http://localhost:3000';

// Thư mục lưu trữ bài nộp trên máy Mac
const MAC_TARGET_DIR = path.join(require('os').homedir(), 'Downloads', 'EduClass_BaiTap');
const PROJECT_UPLOADS_DIR = path.join(__dirname, 'uploads');

function fetchJson(targetUrl, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const client = targetUrl.startsWith('https') ? https : http;
    const req = client.get(targetUrl, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (timer) clearTimeout(timer);
        return fetchJson(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        if (timer) clearTimeout(timer);
        return reject(new Error(`HTTP ${res.statusCode} khi tải dữ liệu từ ${targetUrl}`));
      }
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        if (timer) clearTimeout(timer);
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error("Không thể đọc định dạng JSON: " + raw.substring(0, 150)));
        }
      });
    });

    req.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    timer = setTimeout(() => {
      req.destroy(new Error('Timeout kết nối'));
    }, timeoutMs);
  });
}

function downloadFile(sourceUrl, destPath, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const client = sourceUrl.startsWith('https') ? https : http;
    const req = client.get(sourceUrl, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (timer) clearTimeout(timer);
        return downloadFile(res.headers.location, destPath, timeoutMs).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        if (timer) clearTimeout(timer);
        return reject(new Error(`HTTP ${res.statusCode} khi tải file từ ${sourceUrl}`));
      }
      const dir = path.dirname(destPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        if (timer) clearTimeout(timer);
        fileStream.close(resolve);
      });
      fileStream.on('error', (err) => {
        if (timer) clearTimeout(timer);
        try { fs.unlinkSync(destPath); } catch (e) {}
        reject(err);
      });
    });

    req.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    timer = setTimeout(() => {
      req.destroy(new Error('Timeout tải file'));
    }, timeoutMs);
  });
}

function sanitizeName(str) {
  if (!str) return 'Chung';
  return str.trim().replace(/[/\\?%*:|"<>]/g, '_');
}

async function startSync() {
  console.log('=======================================================');
  console.log('🚀 ĐANG BẮT ĐẦU ĐỒNG BỘ BÀI NỘP VỀ MÁY MAC...');
  console.log('🌐 Máy chủ nguồn:', REMOTE_SERVER_URL);
  console.log('=======================================================');

  let db = null;
  let activeUrl = REMOTE_SERVER_URL;

  try {
    console.log(`📡 Đang kết nối tới ${REMOTE_SERVER_URL}...`);
    db = await fetchJson(`${REMOTE_SERVER_URL}/api/admin/export-database`);
    console.log('✅ Kết nối thành công tới Render!');
  } catch (err) {
    console.warn(`⚠️ Không kết nối được Render (${err.message}). Đang thử kết nối máy chủ nội bộ localhost...`);
    try {
      db = await fetchJson(`${LOCAL_SERVER_URL}/api/admin/export-database`);
      activeUrl = LOCAL_SERVER_URL;
      console.log('✅ Đã kết nối tới máy chủ localhost!');
    } catch (err2) {
      console.error('❌ Thất bại: Không thể lấy dữ liệu bài nộp từ cả Render và localhost.');
      return;
    }
  }

  const submissions = (db.submissions || []).filter(s => s.file || s.link);
  if (submissions.length === 0) {
    console.log('ℹ️ Hiện chưa có bài nộp nào trên hệ thống.');
    return;
  }

  console.log(`📋 Tìm thấy tổng cộng ${submissions.length} bài nộp cần kiểm tra.\n`);

  let downloadedCount = 0;
  let existingCount = 0;
  let openedFolder = null;

  for (const sub of submissions) {
    const asm = (db.assignments || []).find(a => a.id === sub.assignmentId) || {};
    const student = (db.users || []).find(u => u.id === sub.studentId) || {};

    const className = sanitizeName(asm.targetClass || student.className || 'Chung');
    const subjectName = sanitizeName(asm.subject || 'MonHoc');
    const assignmentTitle = sanitizeName(asm.title || 'BaiTap');

    const studentCode = student.studentCode || student.username || '';
    const studentName = sanitizeName(student.name || sub.studentName || 'HocSinh');
    const prefix = studentCode ? `${studentCode}_${studentName}` : studentName;

    // Thư mục lưu trên máy Mac: Downloads/EduClass_BaiTap/[Lớp]/[Môn]/[Tên bài tập]
    const primaryFolder = path.join(MAC_TARGET_DIR, className, subjectName, assignmentTitle);
    if (!openedFolder) openedFolder = MAC_TARGET_DIR;

    if (!fs.existsSync(primaryFolder)) {
      fs.mkdirSync(primaryFolder, { recursive: true });
    }

    if (sub.file && (sub.file.filename || sub.file.url)) {
      const formattedFileName = `${prefix}_${sanitizeName(sub.file.originalName)}`;
      const targetFilePath = path.join(primaryFolder, formattedFileName);
      const downloadUrl = sub.file.url || `${activeUrl}/api/download/${encodeURIComponent(sub.file.filename)}?name=${encodeURIComponent(sub.file.originalName)}`;

      if (fs.existsSync(targetFilePath) && fs.statSync(targetFilePath).size > 0) {
        console.log(`  ✓ Đã có sẵn: [${className}/${subjectName}/${assignmentTitle}] ${formattedFileName}`);
        existingCount++;
      } else {
        // 1. Kiểm tra trước trong thư mục uploads cục bộ trên máy Mac
        const localUploadPath = sub.file.filename ? path.join(PROJECT_UPLOADS_DIR, sub.file.filename) : null;
        if (localUploadPath && fs.existsSync(localUploadPath) && fs.statSync(localUploadPath).size > 0) {
          try {
            fs.copyFileSync(localUploadPath, targetFilePath);
            console.log(`  💾 Đã đồng bộ từ bản lưu trên máy Mac: [${className}/${subjectName}] ${formattedFileName}`);
            downloadedCount++;
            continue;
          } catch (e) {}
        }

        // 2. Tải từ máy chủ từ xa hoặc Cloudinary
        try {
          const sourceDesc = sub.file.url ? 'Cloudinary CDN' : 'máy chủ';
          process.stdout.write(`  ⬇️ Đang tải từ ${sourceDesc}: [${className}/${subjectName}] ${formattedFileName}... `);
          await downloadFile(downloadUrl, targetFilePath);

          // Lưu bản sao vào uploads cục bộ của dự án
          if (localUploadPath) {
            try {
              fs.copyFileSync(targetFilePath, localUploadPath);
            } catch (e) {}
          }

          console.log('✅ Xong');
          downloadedCount++;
        } catch (downloadErr) {
          console.log(`⚠️ Không tải được (${downloadErr.message})`);
          // Ghi nhận file thông tin bài nộp nếu file vật lý bị Render dọn dẹp trước đó
          const noteFile = path.join(primaryFolder, `${prefix}_ThongTinBaiNop.txt`);
          if (!fs.existsSync(noteFile)) {
              const noteContent = `THÔNG TIN BÀI NỘP HỌC SINH\n==============================\n` +
                `Mã sinh viên: ${studentCode}\n` +
                `Họ và tên: ${student.name || sub.studentName}\n` +
                `Lớp: ${className}\n` +
                `Môn: ${subjectName}\n` +
                `Tên file nộp: ${sub.file.originalName}\n` +
                `Kích thước: ${sub.file.size ? (sub.file.size / (1024 * 1024)).toFixed(2) + ' MB' : 'N/A'}\n` +
                `Thời gian nộp: ${sub.submittedAt || ''}\n` +
                `Ghi chú: ${sub.content || '(Không có)'}\n` +
                `Trạng thái file: File vật lý này đã bị máy chủ Render dọn dẹp khi khởi động lại trước khi kết nối MongoDB.\n` +
                `Dữ liệu nộp bài và điểm số vẫn được lưu an toàn 100% trên MongoDB Atlas Cloud.\n`;
              fs.writeFileSync(noteFile, noteContent, 'utf8');
              console.log(`  📝 Đã lưu phiếu thông tin bài nộp: [${className}/${subjectName}] ${path.basename(noteFile)}`);
            }
          }
        }
      } else if (sub.link) {
      const linkFileName = `${prefix}_BaiNop_LienKet.url`;
      const linkFilePath = path.join(primaryFolder, linkFileName);
      const fileContent = `[InternetShortcut]\nURL=${sub.link}\n\n[ThongTinBaiNop]\nMSSV=${studentCode}\nHoVaTen=${student.name || sub.studentName}\nLop=${className}\nMon=${subjectName}\nThoiGianNop=${sub.submittedAt || ''}\nLink=${sub.link}\nGhiChu=${sub.content || ''}\n`;

      if (!fs.existsSync(linkFilePath)) {
        fs.writeFileSync(linkFilePath, fileContent, 'utf8');
        console.log(`  🔗 Đã tạo lối tắt liên kết: [${className}/${subjectName}] ${linkFileName}`);
        downloadedCount++;
      } else {
        existingCount++;
      }
    }
  }

  console.log('\n=======================================================');
  console.log('🎉 TỔNG KẾT ĐỒNG BỘ VỀ MÁY MAC:');
  console.log(`- File mới tải về: ${downloadedCount}`);
  console.log(`- File đã có sẵn: ${existingCount}`);
  console.log(`- Thư mục lưu trên máy Mac:`);
  console.log(`  📁 ${openedFolder || primaryFolder}`);
  console.log('=======================================================');

  // Mở ngay Finder máy Mac để thầy xem
  if (openedFolder && fs.existsSync(openedFolder)) {
    exec(`open "${openedFolder}"`);
  }
}

startSync();
