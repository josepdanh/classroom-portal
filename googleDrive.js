const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// Đường dẫn file credentials local nếu có
const LOCAL_CREDENTIALS_FILE = path.join(__dirname, 'google-credentials.json');
const DEFAULT_ROOT_FOLDER_ID = "1mRpNuDLrSuOR1VVG6Z-KCEi0q-HqJOji";

let driveClient = null;

/**
 * Khởi tạo Google Drive API Client
 */
function initDriveClient() {
  if (driveClient) return driveClient;

  let credentials = null;

  // 1. Kiểm tra biến môi trường GOOGLE_SERVICE_ACCOUNT_KEY (dành cho Render.com)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
      const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY.trim();
      if (raw.startsWith('{')) {
        credentials = JSON.parse(raw);
      } else {
        // Hỗ trợ Base64
        const decoded = Buffer.from(raw, 'base64').toString('utf8');
        credentials = JSON.parse(decoded);
      }
    } catch (err) {
      console.error('[Google Drive API] Lỗi đọc GOOGLE_SERVICE_ACCOUNT_KEY từ env:', err.message);
    }
  }

  // 2. Kiểm tra file credentials local trên máy Mac
  if (!credentials && fs.existsSync(LOCAL_CREDENTIALS_FILE)) {
    try {
      credentials = JSON.parse(fs.readFileSync(LOCAL_CREDENTIALS_FILE, 'utf8'));
    } catch (err) {
      console.error('[Google Drive API] Lỗi đọc file google-credentials.json:', err.message);
    }
  }

  if (!credentials) {
    return null;
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive']
    });

    driveClient = google.drive({ version: 'v3', auth });
    console.log('[Google Drive API] ✅ Đã nạp thành công tài khoản Service Account:', credentials.client_email);
    return driveClient;
  } catch (err) {
    console.error('[Google Drive API] Lỗi khởi tạo GoogleAuth:', err.message);
    return null;
  }
}

/**
 * Kiểm tra xem Google Drive API đã sẵn sàng chưa
 */
function isDriveApiConfigured() {
  return initDriveClient() !== null;
}

/**
 * Tìm hoặc tạo thư mục trên Google Drive
 */
async function findOrCreateFolder(drive, folderName, parentId = null) {
  let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${folderName.replace(/'/g, "\\'")}' and trashed = false`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }

  try {
    const res = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    if (res.data.files && res.data.files.length > 0) {
      return res.data.files[0].id;
    }

    // Nếu chưa có, tạo mới
    const fileMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder'
    };
    if (parentId) {
      fileMetadata.parents = [parentId];
    }

    const created = await drive.files.create({
      requestBody: fileMetadata,
      fields: 'id, name'
    });

    console.log(`[Google Drive API] 📁 Đã tạo thư mục: "${folderName}" (ID: ${created.data.id})`);
    return created.data.id;
  } catch (err) {
    console.error(`[Google Drive API] Lỗi tìm/tạo thư mục "${folderName}":`, err.message);
    throw err;
  }
}

/**
 * Tải file lên Google Drive theo cấu trúc: [Tên Lớp] / [Tên Môn Học] / [Tên File]
 */
async function uploadToGoogleDrive({ filePath, fileName, targetClass, subject, mimeType }) {
  const drive = initDriveClient();
  if (!drive) {
    console.log('[Google Drive API] Chưa cấu hình Service Account. Bỏ qua tải lên Drive qua API.');
    return null;
  }

  if (!fs.existsSync(filePath)) {
    console.error('[Google Drive API] File nguồn không tồn tại:', filePath);
    return null;
  }

  try {
    const cleanClass = (targetClass || 'Chung').trim();
    const cleanSubject = (subject || 'MonHoc').trim();

    // 1. Thư mục gốc (nếu có ROOT_FOLDER_ID thì tạo bên trong đó, nếu không tạo ở root của Drive)
    let parentFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || DEFAULT_ROOT_FOLDER_ID;

    // 2. Tìm hoặc tạo Thư mục cha: [Tên Lớp]
    const classFolderId = await findOrCreateFolder(drive, cleanClass, parentFolderId);

    // 3. Tìm hoặc tạo Thư mục con: [Tên Môn Học]
    const subjectFolderId = await findOrCreateFolder(drive, cleanSubject, classFolderId);

    // 4. Upload file vào thư mục con
    const fileMetadata = {
      name: fileName,
      parents: [subjectFolderId]
    };

    const media = {
      mimeType: mimeType || 'application/octet-stream',
      body: fs.createReadStream(filePath)
    };

    const uploaded = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink, webContentLink'
    });

    console.log(`[Google Drive API] 🚀 Tải lên thành công: "${fileName}" -> Lớp: ${cleanClass} / Môn: ${cleanSubject}`);
    console.log(`[Google Drive API] 🔗 Link xem: ${uploaded.data.webViewLink}`);

    return {
      fileId: uploaded.data.id,
      name: uploaded.data.name,
      webViewLink: uploaded.data.webViewLink,
      webContentLink: uploaded.data.webContentLink
    };
  } catch (err) {
    console.error('[Google Drive API] ❌ Lỗi khi upload file lên Google Drive:', err.message);
    return null;
  }
}

/**
 * Tự động tạo thư mục Môn học trong Lớp và chia sẻ quyền chỉnh sửa cho Giáo viên qua Email
 */
async function setupAndShareSubjectFolder({ targetClass, subject, teacherEmail }) {
  const drive = initDriveClient();
  if (!drive) return null;

  try {
    const cleanClass = (targetClass || 'Chung').trim();
    const cleanSubject = (subject || 'MonHoc').trim();
    const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || DEFAULT_ROOT_FOLDER_ID;

    // 1. Thư mục lớp bên trong EduClass_BaiTap
    const classFolderId = await findOrCreateFolder(drive, cleanClass, rootId);

    // 2. Thư mục môn bên trong Thư mục lớp
    const subjectFolderId = await findOrCreateFolder(drive, cleanSubject, classFolderId);

    // 3. Tự động phân quyền truy cập cho giáo viên qua Email (luôn kèm josepdanh@gmail.com)
    let permissionId = null;
    const targetEmails = Array.from(new Set([
      (teacherEmail || '').trim().toLowerCase(),
      'josepdanh@gmail.com'
    ])).filter(e => e && e.includes('@'));

    for (const email of targetEmails) {
      try {
        const perm = await drive.permissions.create({
          fileId: subjectFolderId,
          sendNotificationEmail: false,
          requestBody: {
            role: 'writer',
            type: 'user',
            emailAddress: email
          }
        });
        if (!permissionId) permissionId = perm.data.id;
        console.log(`[Google Drive API] ✅ Đã tự động cấp quyền truy cập thư mục môn "${cleanSubject}" cho giáo viên: ${email}`);
      } catch (permErr) {
        // Nếu đã được phân quyền trước đó thì bỏ qua lỗi trùng lặp
        if (!permErr.message.includes('already has')) {
          console.error(`[Google Drive API] Lỗi cấp quyền cho ${email}:`, permErr.message);
        }
      }
    }

    return {
      classFolderId,
      subjectFolderId,
      driveLink: `https://drive.google.com/drive/folders/${subjectFolderId}`,
      permissionId
    };
  } catch (err) {
    console.error('[Google Drive API] Lỗi setup và chia sẻ thư mục:', err.message);
    return null;
  }
}

module.exports = {
  initDriveClient,
  isDriveApiConfigured,
  uploadToGoogleDrive,
  setupAndShareSubjectFolder
};
