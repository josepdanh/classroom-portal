// Thiết lập múi giờ Việt Nam (Asia/Ho_Chi_Minh, GMT+7) cho toàn bộ hệ thống
process.env.TZ = 'Asia/Ho_Chi_Minh';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Hàm lấy thời gian hiện tại chuẩn giờ Việt Nam (UTC+7) bất kể máy chủ Cloud chạy ở múi giờ nào (Render UTC)
function getVietnamNow() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (7 * 3600000));
}

const app = express();
const PORT = process.env.PORT || 3000;

// Thư mục lưu trữ dữ liệu và tệp tin tải lên
const BASE_DATA_DIR = process.env.EDUCLASS_DATA_DIR || __dirname;
const DATA_FILE = path.join(BASE_DATA_DIR, 'data.json');
const BACKUP_FILE = path.join(BASE_DATA_DIR, 'data.backup.json');
const BACKUPS_DIR = path.join(BASE_DATA_DIR, 'backups');
const UPLOAD_DIR = path.join(BASE_DATA_DIR, 'uploads');
const MAC_LOCAL_DIR = path.join(os.homedir(), 'Downloads', 'EduClass_BaiTap');

// Tự động tạo thư mục backups và uploads nếu chưa có
if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Hàm hỗ trợ giải mã tên file tiếng Việt chính xác
function decodeFileName(name) {
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch (e) {
    return name;
  }
}

function sanitizeFolderName(name) {
  if (!name) return 'Chung';
  return name.trim().replace(/[/\\?%*:|"<>]/g, '_');
}

// Hàm lưu trữ bài tập cục bộ trên máy Mac (khi chạy server trên Mac)
function saveSubmissionLocally({ filePath, targetClass, subject, studentName, originalName, assignmentTitle }) {
  if (!filePath || !fs.existsSync(filePath)) return;
  try {
    const cleanClass = sanitizeFolderName(targetClass);
    const cleanSubject = sanitizeFolderName(subject);
    const cleanAssignment = assignmentTitle ? sanitizeFolderName(assignmentTitle) : '';
    const cleanStudent = sanitizeFolderName(studentName);
    const cleanOriginal = sanitizeFolderName(originalName);
    const destFolder = cleanAssignment
      ? path.join(MAC_LOCAL_DIR, cleanClass, cleanSubject, cleanAssignment)
      : path.join(MAC_LOCAL_DIR, cleanClass, cleanSubject);
    if (!fs.existsSync(destFolder)) {
      fs.mkdirSync(destFolder, { recursive: true });
    }
    const destFilePath = path.join(destFolder, `${cleanStudent}_${cleanOriginal}`);
    fs.copyFileSync(filePath, destFilePath);
  } catch (err) {}
}

// Cấu hình lưu trữ Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const rawName = decodeFileName(file.originalname);
    const ext = path.extname(rawName);
    const baseName = path.basename(rawName, ext).replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]/g, '_');
    cb(null, `${Date.now()}_${baseName}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 } // Hỗ trợ tải file tới 100MB cho Cloudflare R2
});

// Middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}));
// Cho phép truy cập và xem file tải lên trong thư mục uploads
app.use('/uploads', express.static(UPLOAD_DIR));

// Dữ liệu mẫu (Seed Data)
const initialData = {
  users: [
    {
      id: "u_teacher_1",
      username: "giaovien",
      password: "123",
      name: "Thầy Nguyễn Văn An",
      role: "teacher",
      subject: "Tin học 11"
    },
    {
      id: "u_student_1",
      username: "hocsinh1",
      password: "123",
      name: "Trần Minh Quân",
      role: "student",
      className: "11A1"
    },
    {
      id: "u_student_2",
      username: "hocsinh2",
      password: "123",
      name: "Lê Thu Hà",
      role: "student",
      className: "11A1"
    }
  ],
  assignments: [],
  submissions: []
};

// Cấu hình kết nối MongoDB Atlas (Đám mây vĩnh viễn, chống mất dữ liệu khi cập nhật code)
const { MongoClient } = require('mongodb');
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://josepdanh_db_user:RZr9ZyW1u8Itji2H@cluster0.jdus1os.mongodb.net/educlass?retryWrites=true&w=majority";

// Danh mục chuẩn 3 Nhóm Ngành & 24 Lớp học
const DEFAULT_INDUSTRY_GROUPS = [
  {
    id: "thiet_ke_do_hoa",
    name: "Ngành Thiết Kế Đồ Họa",
    icon: "fa-palette",
    color: "indigo",
    classes: [
      "T14TK01", "T14TK02", "T15TK01", "T15TK02", "C08TK01", "C09TK01", "C10TK01", "L09TK01"
    ]
  },
  {
    id: "cong_nghe_thong_tin",
    name: "Ngành Công Nghệ Thông Tin",
    icon: "fa-laptop-code",
    color: "blue",
    classes: [
      "T14TH01", "T14TH02", "T14MT01", "T14MG01", "T15TH01", "T15TH02", "T15MT01", "T15MT02", "T15MG01", "T15MG02", "L09MG01"
    ]
  },
  {
    id: "may_thoi_trang",
    name: "Ngành May Thời Trang",
    icon: "fa-shirt",
    color: "pink",
    classes: [
      "T14MA01", "T14MA02", "T15MA01", "T15MA02", "L09MA01"
    ]
  }
];

function ensureClassInIndustryGroup(db, className, industryGroupId = null) {
  if (!className || className === 'ALL') return;
  const cleanName = className.trim().toUpperCase();
  if (!db.classes) db.classes = [];
  if (!db.classes.map(c => c.toUpperCase()).includes(cleanName)) {
    db.classes.push(cleanName);
    db.classes.sort();
  }
  if (!db.industryGroups || db.industryGroups.length === 0) {
    db.industryGroups = JSON.parse(JSON.stringify(DEFAULT_INDUSTRY_GROUPS));
  }
  const alreadyInGroup = db.industryGroups.some(g => (g.classes || []).map(c => c.toUpperCase()).includes(cleanName));
  if (!alreadyInGroup) {
    let targetGroupId = industryGroupId;
    if (!targetGroupId) {
      if (cleanName.includes("TK")) targetGroupId = "thiet_ke_do_hoa";
      else if (cleanName.includes("MA")) targetGroupId = "may_thoi_trang";
      else targetGroupId = "cong_nghe_thong_tin";
    }
    const group = db.industryGroups.find(g => g.id === targetGroupId) || db.industryGroups[0];
    if (group) {
      if (!group.classes) group.classes = [];
      if (!group.classes.includes(cleanName)) {
        group.classes.push(cleanName);
        group.classes.sort();
      }
    }
  }
}

let mongoClient = null;
let mongoDbCollection = null;
let memoryCache = null;
let mongoStatus = 'NOT_STARTED';
let lastMongoError = null;

async function initMongoConnection() {
  if (!MONGODB_URI) {
    mongoStatus = 'NO_URI';
    return;
  }
  mongoStatus = 'CONNECTING';
  try {
    mongoClient = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000
    });
    await mongoClient.connect();
    const db = mongoClient.db('educlass');
    mongoDbCollection = db.collection('system_data');
    mongoStatus = 'CONNECTED';
    lastMongoError = null;
    console.log('[MongoDB Atlas] ✅ Đã kết nối thành công tới Database đám mây MongoDB Atlas!');

    // Tải dữ liệu đám mây vào bộ nhớ
    const cloudDoc = await mongoDbCollection.findOne({ id: 'main' });
    if (cloudDoc) {
      delete cloudDoc._id;
      if (!cloudDoc.lessonPlans) cloudDoc.lessonPlans = [];
      if (!cloudDoc.schedule) cloudDoc.schedule = [];
      if (!cloudDoc.attendance) cloudDoc.attendance = [];
      memoryCache = cloudDoc;
      try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(cloudDoc, null, 2), 'utf8');
        fs.writeFileSync(BACKUP_FILE, JSON.stringify(cloudDoc, null, 2), 'utf8');
      } catch (e) {}
      console.log(`[MongoDB Atlas] 📥 Đã tải CSDL từ đám mây: ${cloudDoc.assignments?.length || 0} bài tập, ${cloudDoc.submissions?.length || 0} bài nộp, ${cloudDoc.users?.length || 0} người dùng.`);
    } else {
      const localData = readLocalJsonFile();
      await mongoDbCollection.updateOne(
        { id: 'main' },
        { $set: { id: 'main', ...localData, updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
      memoryCache = localData;
      console.log('[MongoDB Atlas] 📤 Đã nạp CSDL ban đầu lên đám mây Atlas thành công!');
    }
  } catch (err) {
    mongoStatus = 'ERROR';
    lastMongoError = err.message;
    console.error('[MongoDB Atlas Lỗi]:', err.message);
    // Tự động thử kết nối lại sau 30 giây nếu bị từ chối IP hoặc lỗi mạng
    setTimeout(() => {
      if (!mongoDbCollection) {
        console.log('[MongoDB Atlas] Đang tự động thử kết nối lại...');
        initMongoConnection();
      }
    }, 30000);
  }
}

// Cấu hình Cloudflare R2 Storage (10GB Free, hỗ trợ file 100MB+, $0 băng thông tải về)
const { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "de3c89754598ddfb68c7b5947df665ef";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "006fbb0b78af8772fcc2d9953068aa1e";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "dc86e1ecf54214db0697fa84f88dec94d4d1e506e11c56487bbb1435f35727b9";
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "educlass-files";
const R2_PUBLIC_DOMAIN = process.env.R2_PUBLIC_DOMAIN || "https://pub-cd6bf46bdf5c4034bdac614cd4ea7b35.r2.dev";

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY
  }
});

function getMimeType(fileName) {
  const ext = (path.extname(fileName || '')).toLowerCase();
  const map = {
    '.pdf': 'application/pdf',
    '.psd': 'image/vnd.adobe.photoshop',
    '.ai': 'application/postscript',
    '.indd': 'application/x-indesign',
    '.idml': 'application/vnd.adobe.indesign-idml-package',
    '.cdr': 'application/coreldraw',
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    '.7z': 'application/x-7z-compressed',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime'
  };
  return map[ext] || 'application/octet-stream';
}

async function uploadFileToR2(filePath, originalName, className, subjectName, assignmentTitle = '') {
  try {
    const cleanClass = sanitizeFolderName(className || 'Chung');
    const cleanSubject = sanitizeFolderName(subjectName || 'MonHoc');
    const cleanAssignment = assignmentTitle ? sanitizeFolderName(assignmentTitle) : '';
    const ext = path.extname(originalName || filePath);
    const base = path.basename(originalName || filePath, ext).replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]/g, '_');
    const uniqueName = `${Date.now()}_${base}${ext}`;
    const key = cleanAssignment 
      ? `educlass_submissions/${cleanClass}/${cleanSubject}/${cleanAssignment}/${uniqueName}`
      : `educlass_submissions/${cleanClass}/${cleanSubject}/${uniqueName}`;

    const fileBuffer = fs.readFileSync(filePath);
    await r2Client.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: fileBuffer,
      ContentType: getMimeType(originalName)
    }));

    const publicUrl = `${R2_PUBLIC_DOMAIN.replace(/\/$/, '')}/${key}`;
    console.log(`[Cloudflare R2] ⚡ Đã lưu file vĩnh viễn lên Cloudflare R2 (Hỗ trợ 100MB): ${publicUrl}`);
    return { url: publicUrl, key, provider: 'r2' };
  } catch (err) {
    console.error('[Cloudflare R2 Lỗi Upload]:', err.message);
    return null;
  }
}

// Cấu hình Cloudinary lưu trữ file đám mây dự phòng (25GB Free)
const cloudinary = require('cloudinary').v2;
const CLOUDINARY_URL = process.env.CLOUDINARY_URL || "cloudinary://935592411136868:ZbzIp26WqTM0dlRDGbgNm2Jh9hk@riddonyi";
process.env.CLOUDINARY_URL = CLOUDINARY_URL;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'riddonyi',
  api_key: process.env.CLOUDINARY_API_KEY || '935592411136868',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'ZbzIp26WqTM0dlRDGbgNm2Jh9hk'
});

async function uploadFileToCloudinary(filePath, originalName, className, subjectName, assignmentTitle = '') {
  try {
    const cleanClass = sanitizeFolderName(className || 'Chung');
    const cleanSubject = sanitizeFolderName(subjectName || 'MonHoc');
    const cleanAssignment = assignmentTitle ? sanitizeFolderName(assignmentTitle) : '';
    const folder = cleanAssignment
      ? `educlass_submissions/${cleanClass}/${cleanSubject}/${cleanAssignment}`
      : `educlass_submissions/${cleanClass}/${cleanSubject}`;

    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: 'raw',
      type: 'upload',
      access_mode: 'public',
      folder: folder,
      use_filename: true,
      unique_filename: true
    });
    console.log(`[Cloudinary] ☁️ Đã lưu file lên Cloudinary: ${result.secure_url}`);
    return { url: result.secure_url, key: result.public_id, provider: 'cloudinary' };
  } catch (err) {
    console.error('[Cloudinary Lỗi Upload]:', err.message);
    return null;
  }
}

// Hàm tải tệp tin lên đám mây phân luồng theo dung lượng:
// 1. File có dung lượng <= 10MB: Tự động lưu ở Cloudinary (Tận dụng 25GB miễn phí)
// 2. File có dung lượng > 10MB: Tự động chuyển sang Cloudflare R2 (Hỗ trợ file nặng tới 100MB)
async function uploadFileToCloud(filePath, originalName, className, subjectName, fileSize = 0, assignmentTitle = '') {
  const TEN_MB = 10 * 1024 * 1024; // 10 MB = 10,485,760 bytes
  const sizeMB = (fileSize / (1024 * 1024)).toFixed(2);

  if (fileSize <= TEN_MB) {
    console.log(`[Storage Routing] 📦 File "${originalName}" (${sizeMB} MB <= 10MB) -> Lưu trữ tại Cloudinary...`);
    const cldRes = await uploadFileToCloudinary(filePath, originalName, className, subjectName, assignmentTitle);
    if (cldRes && cldRes.url) {
      return cldRes;
    }
    // Dự phòng: Nếu Cloudinary gặp sự cố, tự động lưu sang Cloudflare R2 để bài nộp không bao giờ bị mất
    console.log('[Storage Fallback] Cloudinary gặp sự cố, tự động chuyển lưu sang Cloudflare R2 dự phòng...');
    return await uploadFileToR2(filePath, originalName, className, subjectName, assignmentTitle);
  } else {
    console.log(`[Storage Routing] ⚡ File "${originalName}" (${sizeMB} MB > 10MB) -> Tự động chuyển sang Cloudflare R2...`);
    return await uploadFileToR2(filePath, originalName, className, subjectName, assignmentTitle);
  }
}

// Đọc CSDL từ file JSON cục bộ
function readLocalJsonFile() {
  if (!fs.existsSync(DATA_FILE)) {
    if (fs.existsSync(BACKUP_FILE)) {
      try {
        const backupRaw = fs.readFileSync(BACKUP_FILE, 'utf8');
        const backupData = JSON.parse(backupRaw);
        fs.writeFileSync(DATA_FILE, backupRaw, 'utf8');
        return backupData;
      } catch (e) {}
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2), 'utf8');
    return JSON.parse(JSON.stringify(initialData));
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!data.gradeSheets) data.gradeSheets = [];
    if (!data.subjects) data.subjects = [];
    if (!data.classes || data.classes.length === 0) {
      data.classes = DEFAULT_INDUSTRY_GROUPS.flatMap(g => g.classes).sort();
    }
    if (!data.industryGroups || data.industryGroups.length === 0) {
      data.industryGroups = JSON.parse(JSON.stringify(DEFAULT_INDUSTRY_GROUPS));
    }
    if (!data.notifications) data.notifications = [];
    if (!data.assignments) data.assignments = [];
    if (!data.submissions) data.submissions = [];
    if (!data.lessonPlans) data.lessonPlans = [];
    if (!data.schedule) data.schedule = [];
    if (!data.attendance) data.attendance = [];

    // Tự động chuẩn hóa mã số sinh viên (studentCode) cho toàn bộ học sinh
    if (data.users && Array.isArray(data.users)) {
      data.users.forEach(u => {
        if (u.role === 'student' && !u.studentCode && u.username) {
          u.studentCode = u.username.trim().toUpperCase();
        }
      });
    }

    // Tự động thanh lọc tài khoản danhand1 và các dữ liệu thuộc về tài khoản này (u_teacher_1793618741478)
    let hasPurged = false;
    if (data.users && Array.isArray(data.users)) {
      const uCount = data.users.length;
      data.users = data.users.filter(u => {
        const uname = (u.username || '').trim().toLowerCase();
        const uemail = (u.email || '').trim().toLowerCase();
        return uname !== 'danhand1' && uemail !== 'app.gioitreloduc@gmail.com' && u.id !== 'u_teacher_1793618741478';
      });
      if (data.users.length !== uCount) hasPurged = true;
    }
    if (data.subjects && Array.isArray(data.subjects)) {
      const sCount = data.subjects.length;
      data.subjects = data.subjects.filter(s => {
        return s.teacherId !== 'u_teacher_1793618741478' && s.id !== 'subj_1793618863236';
      });
      if (data.subjects.length !== sCount) hasPurged = true;
    }
    if (data.assignments && Array.isArray(data.assignments)) {
      const aCount = data.assignments.length;
      data.assignments = data.assignments.filter(a => {
        return a.createdBy !== 'u_teacher_1793618741478';
      });
      if (data.assignments.length !== aCount) hasPurged = true;
    }
    if (data.submissions && Array.isArray(data.submissions)) {
      const subCount = data.submissions.length;
      data.submissions = data.submissions.filter(sub => {
        return sub.teacherId !== 'u_teacher_1793618741478';
      });
      if (data.submissions.length !== subCount) hasPurged = true;
    }

    if (hasPurged) {
      try {
        const cleanContent = JSON.stringify(data, null, 2);
        fs.writeFileSync(DATA_FILE, cleanContent, 'utf8');
        fs.writeFileSync(BACKUP_FILE, cleanContent, 'utf8');
      } catch (e) {}
    }

    if (data.assignments.length > 0 || (data.users && data.users.length > 3)) {
      try {
        fs.writeFileSync(BACKUP_FILE, raw, 'utf8');
      } catch (e) {}
    }
    return data;
  } catch (err) {
    console.error("Lỗi đọc database cục bộ. Khôi phục từ backup:", err);
    if (fs.existsSync(BACKUP_FILE)) {
      try {
        const backupRaw = fs.readFileSync(BACKUP_FILE, 'utf8');
        const backupData = JSON.parse(backupRaw);
        fs.writeFileSync(DATA_FILE, backupRaw, 'utf8');
        return backupData;
      } catch (e) {}
    }
    return JSON.parse(JSON.stringify(initialData));
  }
}

// Đọc CSDL (ưu tiên bộ nhớ cache đồng bộ với MongoDB Atlas)
function readDatabase() {
  if (memoryCache) {
    return memoryCache;
  }
  return readLocalJsonFile();
}

// Ghi CSDL (đồng bộ vào cả bộ nhớ, file data.json cục bộ và MongoDB Atlas đám mây)
function writeDatabase(data) {
  memoryCache = data;
  try {
    const content = JSON.stringify(data, null, 2);
    // 1. Ghi vào file CSDL chính
    fs.writeFileSync(DATA_FILE, content, 'utf8');

    // 2. Tự động lưu bản backup an toàn (data.backup.json) chống bị git đè
    fs.writeFileSync(BACKUP_FILE, content, 'utf8');

    // 3. Tự động lưu bản snapshot định kỳ trong thư mục backups/
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const dailyFile = path.join(BACKUPS_DIR, `data_${dateStr}.json`);
    if (!fs.existsSync(dailyFile)) {
      fs.writeFileSync(dailyFile, content, 'utf8');
    }
  } catch (err) {
    console.error("Lỗi ghi CSDL:", err);
  }

  // 4. Đồng bộ thời gian thực lên MongoDB Atlas Cloud
  if (mongoDbCollection) {
    mongoDbCollection.updateOne(
      { id: 'main' },
      { $set: { id: 'main', ...data, updatedAt: new Date().toISOString() } },
      { upsert: true }
    ).catch(e => console.error("[MongoDB Atlas] Lỗi cập nhật đám mây:", e.message));
  }
}

// Khởi tạo kết nối MongoDB Atlas khi bắt đầu
initMongoConnection();
readDatabase();

// API giám sát hệ thống và trạng thái kết nối Cloud Database
app.get('/api/system/status', (req, res) => {
  const db = readDatabase();
  res.json({
    status: 'ok',
    mongoStatus,
    lastMongoError,
    isMongoConnected: !!mongoDbCollection,
    hasMemoryCache: !!memoryCache,
    cloudinaryConnected: true,
    cloudinaryCloud: 'riddonyi',
    assignmentsCount: (db.assignments || []).length,
    submissionsCount: (db.submissions || []).length,
    usersCount: (db.users || []).length,
    assignments: (db.assignments || []).map(a => ({ id: a.id, title: a.title, targetClass: a.targetClass })),
    timestamp: new Date().toISOString()
  });
});

// Chuẩn hóa viết hoa chữ cái đầu cho mỗi từ của Họ và Tên (Tiếng Việt)
function capitalizeWords(str) {
  if (!str) return "";
  return str
    .trim()
    .split(/\s+/)
    .map(word => {
      // Giữ nguyên các mã như C08TK01, T15MG02 hoặc từ viết tắt
      if (/^[A-Z0-9_]+$/i.test(word) && /\d/.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

// Chuẩn hóa ngày sinh thành dạng DD/MM/YYYY
function formatDob(str) {
  if (!str) return "";
  str = str.trim();
  const ymdMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymdMatch) {
    return `${ymdMatch[3].padStart(2, "0")}/${ymdMatch[2].padStart(2, "0")}/${ymdMatch[1]}`;
  }
  const dmyMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmyMatch) {
    return `${dmyMatch[1].padStart(2, "0")}/${dmyMatch[2].padStart(2, "0")}/${dmyMatch[3]}`;
  }
  return str;
}

// ================= API ENDPOINTS =================

// 1. Đăng nhập (Không phân biệt chữ hoa, chữ thường cho tên tài khoản)
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: "Vui lòng nhập đầy đủ tài khoản và mật khẩu." });
  }

  // Chặn hoàn toàn tài khoản đã xóa danhand1
  const inputCheck = (username || '').trim().toLowerCase();
  if (inputCheck === 'danhand1' || inputCheck === 'app.gioitreloduc@gmail.com') {
    return res.status(401).json({ message: "Tài khoản hoặc mật khẩu không chính xác." });
  }

  const db = readDatabase();
  const norm = (str) => (str || '').toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "d")
    .replace(/\s+/g, "");

  const cleanInputUser = norm(username);
  const cleanInputPass = password.trim();

  // Tìm người dùng: hỗ trợ không phân biệt hoa thường, có dấu tiếng Việt, có/không khoảng trắng, đăng nhập bằng MSSV hoặc username
  const user = db.users.find(u => {
    const dbUserNorm = norm(u.username);
    const dbNameNorm = norm(u.name);
    const dbCodeNorm = norm(u.studentCode);
    const userMatch = (
      u.username.trim().toLowerCase() === username.trim().toLowerCase() ||
      (u.studentCode && u.studentCode.trim().toLowerCase() === username.trim().toLowerCase()) ||
      dbUserNorm === cleanInputUser ||
      (dbCodeNorm && dbCodeNorm === cleanInputUser) ||
      (dbNameNorm === cleanInputUser && u.role === 'teacher') ||
      (cleanInputUser.includes('nguyencongdanh') && dbUserNorm.includes('nguyencongdanh'))
    );

    if (!userMatch) return false;

    // Khớp mật khẩu
    if (u.password.trim() === cleanInputPass) return true;
    
    // Đặc biệt hỗ trợ Thầy Nguyễn Công Danh nếu gõ 12345678, 12345679, 123456...
    if (dbUserNorm.includes('nguyencongdanh')) {
      if (['12345679', '12345678', '123456789', '123456', '12345', '123'].includes(cleanInputPass)) {
        return true;
      }
    }

    return false;
  });

  if (!user) {
    return res.status(401).json({ message: "Tài khoản hoặc mật khẩu không chính xác." });
  }

  // KIỂM TRA TRẠNG THÁI DUYỆT TÀI KHOẢN TỪ ADMIN
  if (user.status === 'PENDING') {
    return res.status(403).json({ 
      message: "Tài khoản của bạn đang ở trạng thái CHỜ PHÊ DUYỆT từ Quản trị viên (Thầy Nguyễn Công Danh). Vui lòng liên hệ thầy hoặc quay lại sau!" 
    });
  }

  const { password: _, ...userInfo } = user;
  return res.json({ success: true, user: userInfo });
});

// 1c. Xác thực phiên đăng nhập duy trì (Keep-alive / Verify session)
app.get('/api/auth/verify', (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ valid: false });
  const db = readDatabase();
  const user = db.users.find(u => u.id === id);
  if (!user) {
    return res.status(404).json({ valid: false, message: "Tài khoản không tồn tại." });
  }
  if (user.status === 'PENDING') {
    return res.status(403).json({ valid: false, pending: true, message: "Tài khoản đang chờ phê duyệt từ Quản trị viên." });
  }
  const { password: _, ...userInfo } = user;
  return res.json({ valid: true, user: userInfo });
});

// 1b. Đăng ký tài khoản mới (Giáo viên hoặc Học sinh)
app.post('/api/auth/register', (req, res) => {
  const { username, password, name, role, className, subject, email, dob, studentCode } = req.body;
  if (!username || !password || !name || !role) {
    return res.status(400).json({ message: "Vui lòng điền đầy đủ các thông tin bắt buộc." });
  }

  const cleanStudentCode = role === 'student'
    ? (studentCode ? studentCode.trim().toUpperCase() : username.trim().toUpperCase())
    : undefined;

  const db = readDatabase();
  const existing = db.users.find(u => {
    if (u.username.toLowerCase() === username.trim().toLowerCase()) return true;
    if (cleanStudentCode && u.studentCode && u.studentCode.toUpperCase() === cleanStudentCode) return true;
    return false;
  });

  if (existing) {
    const isDupCode = cleanStudentCode && existing.studentCode && existing.studentCode.toUpperCase() === cleanStudentCode;
    return res.status(400).json({ 
      message: isDupCode 
        ? `Mã số sinh viên ${cleanStudentCode} đã tồn tại trong hệ thống (thuộc về học sinh ${existing.name})!` 
        : "Tên đăng nhập này đã tồn tại, vui lòng chọn tên khác." 
    });
  }

  // BẢO VỆ CHỐNG HỌC SINH MẠO DANH GIÁO VIÊN:
  // Nếu đăng ký vai trò Giáo viên -> BẮT BUỘC trạng thái PENDING chờ Thầy Nguyễn Công Danh phê duyệt!
  const isTeacher = (role === 'teacher');
  const userStatus = isTeacher ? 'PENDING' : 'ACTIVE';

  const cleanName = capitalizeWords(name);
  const cleanDob = role === 'student' ? (formatDob(dob) || undefined) : undefined;

  const newUser = {
    id: `u_${role}_${Date.now()}`,
    username: username.trim(),
    studentCode: cleanStudentCode,
    password: password.trim(),
    name: cleanName,
    dob: cleanDob,
    email: email && email.includes('@') ? email.trim().toLowerCase() : undefined,
    role: role,
    className: role === 'student' ? (className ? className.trim().toUpperCase() : 'T15MG02') : undefined,
    subject: role === 'teacher' ? (subject ? subject.trim() : 'Tin học') : undefined,
    status: userStatus,
    createdAt: new Date().toISOString()
  };

  db.users.push(newUser);
  writeDatabase(db);

  const { password: _, ...userInfo } = newUser;
  const msg = isTeacher
    ? "Đăng ký thành công! Vì bạn chọn vai trò Giáo viên, tài khoản đang CHỜ THẦY NGUYỄN CÔNG DANH PHÊ DUYỆT trước khi có thể đăng nhập."
    : "Đăng ký tài khoản Học sinh thành công!";

  return res.json({ success: true, pendingApproval: isTeacher, message: msg, user: isTeacher ? null : userInfo });
});

// 1c. Quản lý danh mục Lớp học & Nhóm ngành đào tạo
app.get('/api/classes', (req, res) => {
  const db = readDatabase();
  const classesFromUsers = db.users
    .filter(u => u.role === 'student' && u.className)
    .map(u => u.className.trim().toUpperCase());
  const definedClasses = (db.classes || []).map(c => c.trim().toUpperCase());
  
  const groups = (db.industryGroups && db.industryGroups.length > 0) ? db.industryGroups : JSON.parse(JSON.stringify(DEFAULT_INDUSTRY_GROUPS));
  const classesFromGroups = groups.flatMap(g => g.classes || []).map(c => c.trim().toUpperCase());

  const allUnique = Array.from(new Set([...classesFromGroups, ...definedClasses, ...classesFromUsers])).filter(Boolean).sort();

  // Đảm bảo từng lớp đều thuộc về một nhóm ngành cụ thể
  allUnique.forEach(cls => {
    ensureClassInIndustryGroup(db, cls);
  });

  const finalGroups = (db.industryGroups && db.industryGroups.length > 0) ? db.industryGroups : groups;

  res.json({
    classes: allUnique,
    industryGroups: finalGroups
  });
});

// CHỈ ADMIN (Thầy Nguyễn Công Danh) MỚI CÓ QUYỀN TẠO THÊM LỚP HỌC MỚI
app.post('/api/classes', (req, res) => {
  const { name, adminId, industryGroupId } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ message: "Vui lòng nhập tên lớp học." });
  }

  const db = readDatabase();
  const admin = db.users.find(u => (u.id === adminId && u.isAdmin) || (u.id === 'u_teacher_danh'));
  if (!admin) {
    return res.status(403).json({ 
      message: "Chỉ Quản trị viên (Thầy Nguyễn Công Danh) mới có quyền tạo thêm lớp học mới! Các giáo viên khác chỉ chọn lớp và tự tạo môn học cho lớp đó." 
    });
  }

  const cleanName = name.trim().toUpperCase();
  ensureClassInIndustryGroup(db, cleanName, industryGroupId);
  writeDatabase(db);

  const matchedGroup = (db.industryGroups || []).find(g => (g.classes || []).map(c => c.toUpperCase()).includes(cleanName));
  res.json({
    success: true,
    message: `Đã tạo lớp ${cleanName} ${matchedGroup ? `thuộc ${matchedGroup.name}` : ''} thành công!`,
    className: cleanName,
    industryGroup: matchedGroup
  });
});

// 1e. Quản lý Môn học (Giáo viên tự tạo môn học cho từng lớp)
app.get('/api/subjects', (req, res) => {
  const { className, teacherId, forGradeSheet, isCompleted } = req.query;
  const db = readDatabase();
  let subjects = db.subjects || [];

  if (className && className !== 'ALL') {
    subjects = subjects.filter(s => s.className.toUpperCase() === className.toUpperCase());
  }
  if (teacherId) {
    const user = (db.users || []).find(u => u.id === teacherId);
    const isDanhOrAdmin = user && (user.isAdmin || (user.name && user.name.toLowerCase().includes('công danh')));
    // Nếu là chế độ xem Sổ Điểm (forGradeSheet) HOẶC không phải Admin: CHỈ trả về môn do giáo viên này phụ trách
    if (!isDanhOrAdmin || forGradeSheet === 'true') {
      subjects = subjects.filter(s => s.teacherId === teacherId);
    }
  }

  // Lọc theo trạng thái kết thúc nếu có yêu cầu
  if (typeof isCompleted !== 'undefined') {
    const wantCompleted = isCompleted === 'true';
    subjects = subjects.filter(s => Boolean(s.isCompleted) === wantCompleted);
  }

  // Đảm bảo thuộc tính isCompleted luôn là boolean
  const mappedSubjects = subjects.map(s => ({
    ...s,
    isCompleted: Boolean(s.isCompleted)
  }));

  res.json({ subjects: mappedSubjects });
});

app.post('/api/subjects', async (req, res) => {
  const { className, name, teacherId } = req.body;
  if (!className || !name || !name.trim() || !teacherId) {
    return res.status(400).json({ message: "Vui lòng chọn lớp, nhập tên môn học và xác nhận tài khoản giáo viên." });
  }

  const db = readDatabase();
  const teacher = db.users.find(u => u.id === teacherId && u.role === 'teacher' && u.status === 'ACTIVE');
  if (!teacher) {
    return res.status(403).json({ message: "Chỉ giáo viên đã được kích hoạt mới có quyền tạo môn học." });
  }

  const cleanClassName = className.trim().toUpperCase();
  const cleanSubjectName = name.trim();

  if (!db.subjects) db.subjects = [];

  const existing = db.subjects.find(
    s => s.className.toUpperCase() === cleanClassName && 
         s.name.toLowerCase() === cleanSubjectName.toLowerCase() &&
         s.teacherId === teacherId
  );
  if (existing) {
    return res.status(400).json({ message: `Bạn đã tạo môn "${cleanSubjectName}" cho lớp ${cleanClassName} rồi!` });
  }

  const newSubject = {
    id: `subj_${Date.now()}`,
    name: cleanSubjectName,
    className: cleanClassName,
    teacherId: teacher.id,
    teacherName: teacher.name,
    teacherEmail: teacher.email || null,
    isCompleted: false,
    createdAt: new Date().toISOString()
  };

  db.subjects.push(newSubject);
  writeDatabase(db);

  res.json({ 
    success: true, 
    message: `Đã tạo môn học "${cleanSubjectName}" cho lớp ${cleanClassName} thành công!`, 
    subject: newSubject 
  });
});

// Endpoint cho phép giáo viên cập nhật email Google của mình
app.post('/api/teacher/update-email', (req, res) => {
  const { teacherId, email } = req.body;
  if (!teacherId || !email || !email.includes('@')) {
    return res.status(400).json({ message: "Vui lòng nhập địa chỉ email Google hợp lệ." });
  }
  const db = readDatabase();
  const teacher = db.users.find(u => u.id === teacherId && u.role === 'teacher');
  if (!teacher) {
    return res.status(404).json({ message: "Không tìm thấy tài khoản giáo viên." });
  }
  teacher.email = email.trim().toLowerCase();
  writeDatabase(db);
  res.json({ success: true, message: `Đã lưu email Google: ${teacher.email}`, email: teacher.email });
});

app.delete('/api/subjects/:id', (req, res) => {
  const { id } = req.params;
  const { teacherId } = req.query;
  const db = readDatabase();

  const user = db.users.find(u => u.id === teacherId);
  if (!user || user.role !== 'teacher') {
    return res.status(403).json({ message: "Chỉ giáo viên mới có quyền thao tác." });
  }

  const target = (db.subjects || []).find(s => s.id === id);
  if (!target) {
    return res.status(404).json({ message: "Không tìm thấy môn học cần xóa." });
  }

  if (target.teacherId !== teacherId && !user.isAdmin) {
    return res.status(403).json({ message: "Bạn chỉ có thể xóa môn học do chính bạn tạo ra." });
  }

  db.subjects = db.subjects.filter(s => s.id !== id);
  writeDatabase(db);

  res.json({ success: true, message: `Đã xóa môn "${target.name}" của lớp ${target.className} thành công!` });
});

// Endpoint cho phép giáo viên đánh dấu KẾT THÚC hoặc MỞ LẠI môn học
app.post('/api/subjects/:id/toggle-completed', (req, res) => {
  const { id } = req.params;
  const { teacherId, isCompleted } = req.body;
  const db = readDatabase();

  const user = (db.users || []).find(u => u.id === teacherId);
  if (!user || user.role !== 'teacher') {
    return res.status(403).json({ message: "Chỉ giáo viên mới có quyền thay đổi trạng thái môn học." });
  }

  const target = (db.subjects || []).find(s => s.id === id);
  if (!target) {
    return res.status(404).json({ message: "Không tìm thấy môn học." });
  }

  if (target.teacherId !== teacherId && !user.isAdmin) {
    return res.status(403).json({ message: "Bạn chỉ có thể thay đổi trạng thái môn học do chính bạn phụ trách." });
  }

  if (typeof isCompleted === 'boolean') {
    target.isCompleted = isCompleted;
  } else {
    target.isCompleted = !target.isCompleted;
  }

  if (target.isCompleted) {
    target.completedAt = new Date().toISOString();
  } else {
    delete target.completedAt;
  }

  writeDatabase(db);

  const statusLabel = target.isCompleted ? "ĐÃ KẾT THÚC" : "ĐANG HỌC (CHƯA KẾT THÚC)";
  res.json({
    success: true,
    isCompleted: target.isCompleted,
    subject: target,
    message: `Đã chuyển môn "${target.name}" lớp ${target.className} sang trạng thái: ${statusLabel}!`
  });
});

// Cho phép học sinh đổi / chọn lớp học
app.post('/api/students/update-class', (req, res) => {
  const { studentId, newClass } = req.body;
  if (!studentId || !newClass) {
    return res.status(400).json({ message: "Thiếu thông tin học sinh hoặc lớp học." });
  }
  const db = readDatabase();
  const student = db.users.find(u => u.id === studentId && u.role === 'student');
  if (!student) {
    return res.status(404).json({ message: "Không tìm thấy học sinh." });
  }
  student.className = newClass.trim().toUpperCase();
  writeDatabase(db);
  const { password: _, ...userInfo } = student;
  res.json({ success: true, message: `Đã đổi sang lớp ${student.className} thành công!`, user: userInfo });
});

// 1d. Quản trị viên (Thầy Nguyễn Công Danh) duyệt người dùng
app.get('/api/admin/users', (req, res) => {
  const { adminId } = req.query;
  const db = readDatabase();

  const admin = db.users.find(u => u.id === adminId && u.isAdmin);
  if (!admin) {
    return res.status(403).json({ message: "Chỉ Quản trị viên mới có quyền xem danh sách này." });
  }

  const sanitizedUsers = db.users.map(({ password: _, ...u }) => u);
  res.json({ users: sanitizedUsers });
});

// Quản trị viên phê duyệt tài khoản Giáo viên
app.post('/api/admin/users/:id/approve', (req, res) => {
  const { id } = req.params;
  const { adminId } = req.body;
  const db = readDatabase();

  const admin = db.users.find(u => u.id === adminId && u.isAdmin);
  if (!admin) {
    return res.status(403).json({ message: "Chỉ Quản trị viên mới có quyền duyệt tài khoản." });
  }

  const target = db.users.find(u => u.id === id);
  if (!target) {
    return res.status(404).json({ message: "Không tìm thấy người dùng." });
  }

  target.status = 'ACTIVE';
  writeDatabase(db);
  res.json({ success: true, message: `Đã phê duyệt tài khoản ${target.name} (${target.username}) thành công!` });
});

// Quản trị viên chuyển tài khoản mạo danh giáo viên về vai trò Học sinh
app.post('/api/admin/users/:id/convert-to-student', (req, res) => {
  const { id } = req.params;
  const { adminId, className } = req.body;
  const db = readDatabase();

  const admin = db.users.find(u => u.id === adminId && u.isAdmin);
  if (!admin) {
    return res.status(403).json({ message: "Chỉ Quản trị viên mới có quyền thao tác." });
  }

  const target = db.users.find(u => u.id === id);
  if (!target) {
    return res.status(404).json({ message: "Không tìm thấy người dùng." });
  }

  target.role = 'student';
  target.className = className ? className.trim().toUpperCase() : 'T15MG02';
  delete target.subject;
  target.status = 'ACTIVE';

  writeDatabase(db);
  res.json({ success: true, message: `Đã chuyển tài khoản ${target.name} thành Học sinh lớp ${target.className} và kích hoạt thành công!` });
});

// Quản trị viên xóa tài khoản
app.delete('/api/admin/users/:id', (req, res) => {
  const { id } = req.params;
  const { adminId } = req.query;
  const db = readDatabase();

  const admin = db.users.find(u => u.id === adminId && u.isAdmin);
  if (!admin) {
    return res.status(403).json({ message: "Chỉ Quản trị viên mới có quyền xóa tài khoản." });
  }

  if (id === adminId) {
    return res.status(400).json({ message: "Bạn không thể tự xóa tài khoản Quản trị viên của mình." });
  }

  db.users = db.users.filter(u => u.id !== id);
  writeDatabase(db);
  res.json({ success: true, message: "Đã xóa tài khoản thành công." });
});

// ================= HỆ THỐNG THÔNG BÁO THỜI GIAN THỰC TỚI THIẾT BỊ HỌC SINH (SSE) =================
const sseClients = new Set();

function broadcastNotification(notification) {
  const targetClass = (notification.targetClass || 'ALL').trim().toUpperCase();
  const payload = JSON.stringify({ type: 'NEW_ASSIGNMENT', notification });

  for (const client of sseClients) {
    // CHỈ THÔNG BÁO CHO THIẾT BỊ HỌC SINH THUỘC ĐÚNG LỚP ĐƯỢC GIAO (HOẶC ALL)
    if (targetClass === 'ALL' || client.className === targetClass) {
      try {
        client.res.write(`data: ${payload}\n\n`);
      } catch (err) {
        console.error("Lỗi gửi thông báo SSE:", err);
      }
    }
  }
}

// Duy trì kết nối SSE không bị ngắt qua mạng / proxy
setInterval(() => {
  for (const client of sseClients) {
    try {
      client.res.write(': keepalive\n\n');
    } catch (e) {
      sseClients.delete(client);
    }
  }
}, 25000);

// 2. Lấy danh sách bài tập (Phân tách độc lập theo từng Giáo viên và từng Lớp học)
app.get('/api/assignments', (req, res) => {
  const { studentId, teacherId, teacherFilterClass, viewAllTeachers } = req.query;
  const db = readDatabase();

  let targetAssignments = db.assignments || [];

  // PHÂN QUYỀN HỌC SINH: Học sinh chỉ thấy bài tập của đúng lớp mình (hoặc giao chung ALL)
  if (studentId) {
    const student = (db.users || []).find(u => u.id === studentId);
    if (student && student.className) {
      const studentClass = student.className.trim().toUpperCase();
      targetAssignments = targetAssignments.filter(asm => {
        if (!asm.targetClass || asm.targetClass.toUpperCase() === 'ALL') return true;
        return asm.targetClass.trim().toUpperCase() === studentClass;
      });
    }
  } else if (teacherId) {
    const user = (db.users || []).find(u => u.id === teacherId);
    const isDanhOrAdmin = user && (user.isAdmin || (user.name && user.name.toLowerCase().includes('công danh')));
    const isExaminer = user && (user.isExaminer || (user.username && user.username.toLowerCase() === 'phongkhaothi'));

    if (isExaminer) {
      // PHÒNG KHẢO THÍ: Chỉ xem các bài tập do Admin chỉ định lưu trữ hoặc chia sẻ
      targetAssignments = targetAssignments.filter(asm => {
        return asm.isArchivedForExaminer === true ||
          (Array.isArray(asm.sharedWith) && (asm.sharedWith.includes(teacherId) || asm.sharedWith.includes('u_phongkhaothi'))) ||
          asm.createdBy === teacherId;
      });
    } else if (isDanhOrAdmin) {
      // QUẢN TRỊ VIÊN (Admin / Thầy Nguyễn Công Danh): Mặc định thấy tất cả bài tập để quản lý và phân quyền Khảo Thí
      if (viewAllTeachers === 'false') {
        targetAssignments = targetAssignments.filter(asm => {
          if (asm.createdBy === teacherId) return true;
          const creator = (db.users || []).find(u => u.id === asm.createdBy);
          return !creator || creator.isAdmin || (creator.name && creator.name.toLowerCase().includes('công danh'));
        });
      } else {
        // Xem toàn bộ bài tập của toàn bộ giáo viên
        targetAssignments = db.assignments || [];
      }
    } else {
      // Giáo viên thông thường: Chỉ xem bài tập do chính mình tạo
      targetAssignments = targetAssignments.filter(asm => asm.createdBy === teacherId);
    }

    // Nếu giáo viên chọn lọc theo 1 lớp cụ thể
    if (teacherFilterClass && teacherFilterClass !== 'ALL') {
      const filterClass = teacherFilterClass.trim().toUpperCase();
      targetAssignments = targetAssignments.filter(asm => {
        return asm.targetClass && asm.targetClass.trim().toUpperCase() === filterClass;
      });
    }
  }

  const result = targetAssignments.map(asm => {
    const submissions = (db.submissions || []).filter(s => s.assignmentId === asm.id);
    const submittedCount = submissions.length;
    const gradedCount = submissions.filter(s => s.grade !== null && s.grade !== undefined).length;

    // Tìm thông tin giáo viên tạo bài để hiển thị cho học sinh và quản trị
    const teacher = (db.users || []).find(u => u.id === asm.createdBy);
    const teacherName = teacher ? teacher.name : 'Giáo viên';
    const teacherSubject = teacher ? teacher.subject : '';

    // Tính sĩ số chuẩn theo từng lớp được giao bài tập
    let totalStudents = (db.users || []).filter(u => u.role === 'student').length;
    if (asm.targetClass && asm.targetClass.toUpperCase() !== 'ALL') {
      totalStudents = (db.users || []).filter(u => 
        u.role === 'student' && u.className && u.className.trim().toUpperCase() === asm.targetClass.trim().toUpperCase()
      ).length;
    }

    let studentStatus = 'NOT_SUBMITTED';
    let mySubmission = null;

    if (studentId) {
      mySubmission = submissions.find(s => s.studentId === studentId) || null;
      if (mySubmission) {
        studentStatus = (mySubmission.grade !== null && mySubmission.grade !== undefined) 
          ? 'GRADED' 
          : 'SUBMITTED';
      }
    }

    const isArchivedForExaminer = !!(
      asm.isArchivedForExaminer === true || 
      (Array.isArray(asm.sharedWith) && (asm.sharedWith.includes('u_phongkhaothi') || (teacherId && asm.sharedWith.includes(teacherId))))
    );

    return {
      ...asm,
      targetClass: asm.targetClass || 'ALL',
      subject: asm.subject || teacherSubject || 'Tin học',
      teacherName,
      creatorName: teacherName,
      teacherSubject,
      isArchivedForExaminer,
      stats: {
        totalStudents,
        submittedCount,
        gradedCount,
        pendingCount: submittedCount - gradedCount
      },
      studentStatus,
      mySubmission
    };
  });

  res.json({ assignments: result });
});

// 3. Giáo viên tạo bài tập mới (Chỉ định rõ lớp học nhận bài và Môn học)
app.post('/api/assignments', upload.single('attachment'), async (req, res) => {
  const { title, description, dueDate, teacherId, targetClass, subject } = req.body;

  if (!title || !description || !dueDate) {
    return res.status(400).json({ message: "Vui lòng điền đầy đủ tiêu đề, yêu cầu và hạn nộp." });
  }

  const db = readDatabase();
  const cleanTargetClass = targetClass && targetClass.trim() ? targetClass.trim().toUpperCase() : 'ALL';
  const teacher = db.users.find(u => u.id === teacherId);
  const cleanSubject = (subject && subject.trim()) ? subject.trim() : (teacher && teacher.subject ? teacher.subject : 'Tin học');

  // Tự động ghi nhớ lớp mới nếu chưa có
  if (cleanTargetClass !== 'ALL') {
    ensureClassInIndustryGroup(db, cleanTargetClass);

    // Tự động lưu môn học vào danh mục môn của lớp này nếu chưa có
    if (!db.subjects) db.subjects = [];
    const hasSub = db.subjects.some(
      s => s.className.toUpperCase() === cleanTargetClass && 
           s.name.toLowerCase() === cleanSubject.toLowerCase() && 
           s.teacherId === teacherId
    );
    if (!hasSub) {
      db.subjects.push({
        id: `subj_${Date.now()}`,
        name: cleanSubject,
        className: cleanTargetClass,
        teacherId: teacher ? teacher.id : (teacherId || 'u_teacher_danh'),
        teacherName: teacher ? teacher.name : 'Giáo viên',
        isCompleted: false,
        createdAt: new Date().toISOString()
      });
    }
  }

  let attachment = null;
  if (req.file) {
    attachment = {
      filename: req.file.filename,
      originalName: decodeFileName(req.file.originalname),
      size: req.file.size
    };
    try {
      const cloudRes = await uploadFileToCloud(req.file.path, attachment.originalName, cleanTargetClass, cleanSubject, req.file.size, title.trim());
      if (cloudRes && cloudRes.url) {
        attachment.url = cloudRes.url;
        attachment.storageKey = cloudRes.key;
        attachment.provider = cloudRes.provider;
      }
    } catch (e) {
      console.error("[Storage] Lỗi tải file đính kèm đề bài:", e.message);
    }
  }

  const newAssignment = {
    id: `asm_${Date.now()}`,
    title: title.trim(),
    description: description.trim(),
    targetClass: cleanTargetClass,
    subject: cleanSubject,
    dueDate,
    createdAt: new Date().toISOString(),
    attachment,
    createdBy: teacherId || "u_teacher_danh"
  };

  // Lưu bản đề bài cục bộ nếu chạy trên máy Mac
  if (req.file) {
    saveSubmissionLocally({
      filePath: req.file.path,
      targetClass: cleanTargetClass,
      subject: cleanSubject,
      studentName: 'DE_BAI',
      originalName: decodeFileName(req.file.originalname)
    });
  }

  db.assignments.unshift(newAssignment);

  // Tạo bản ghi thông báo và gửi ngay tới thiết bị của các học sinh thuộc lớp cleanTargetClass
  const newNotification = {
    id: `notif_${Date.now()}`,
    type: 'NEW_ASSIGNMENT',
    assignmentId: newAssignment.id,
    title: newAssignment.title,
    description: newAssignment.description,
    targetClass: cleanTargetClass,
    subject: cleanSubject,
    dueDate: newAssignment.dueDate,
    teacherName: teacher ? teacher.name : 'Giáo viên',
    teacherId: teacher ? teacher.id : (teacherId || 'u_teacher_danh'),
    createdAt: new Date().toISOString(),
    readBy: []
  };

  if (!db.notifications) db.notifications = [];
  db.notifications.unshift(newNotification);
  if (db.notifications.length > 100) db.notifications = db.notifications.slice(0, 100);

  writeDatabase(db);

  // Phát thông báo đẩy tức thời tới các thiết bị học sinh của đúng lớp được giao
  broadcastNotification(newNotification);

  res.json({ success: true, message: `Giao bài tập mới cho lớp ${cleanTargetClass} thành công! Hệ thống đã phát thông báo tới thiết bị của học sinh.`, assignment: newAssignment });
});

// 4. Giáo viên xóa bài tập (Chỉ người tạo mới được xóa, trừ Khảo Thí)
app.delete('/api/assignments/:id', (req, res) => {
  const { id } = req.params;
  const { teacherId } = req.query;
  const db = readDatabase();

  const target = db.assignments.find(a => a.id === id);
  if (!target) {
    return res.status(404).json({ message: "Không tìm thấy bài tập cần xóa." });
  }

  if (teacherId) {
    const user = (db.users || []).find(u => u.id === teacherId);
    const isExaminer = user && (user.isExaminer || (user.username && user.username.toLowerCase() === 'phongkhaothi'));
    if (isExaminer) {
      return res.status(403).json({ message: "Tài khoản Phòng Khảo Thí chỉ có quyền lưu trữ, không được xóa bài tập." });
    }
    if (target.createdBy && target.createdBy !== teacherId) {
      return res.status(403).json({ message: "Bạn không có quyền xóa bài tập của giáo viên khác." });
    }
  }

  db.assignments = db.assignments.filter(a => a.id !== id);
  db.submissions = db.submissions.filter(s => s.assignmentId !== id);
  if (db.notifications) {
    db.notifications = db.notifications.filter(n => n.assignmentId !== id);
  }

  writeDatabase(db);
  res.json({ success: true, message: "Đã xóa bài tập thành công." });
});

// 4b. Admin phân quyền / gỡ bài tập cho Phòng Khảo Thí lưu trữ
app.post('/api/assignments/:id/toggle-examiner', (req, res) => {
  const { id } = req.params;
  const { adminId } = req.body;
  const db = readDatabase();

  const user = (db.users || []).find(u => u.id === adminId);
  const isDanhOrAdmin = user && (user.isAdmin || (user.name && user.name.toLowerCase().includes('công danh')));
  if (!isDanhOrAdmin) {
    return res.status(403).json({ message: "Chỉ Quản trị viên (Admin) mới có quyền phân quyền bài tập cho Phòng Khảo Thí." });
  }

  const asm = (db.assignments || []).find(a => a.id === id);
  if (!asm) {
    return res.status(404).json({ message: "Không tìm thấy bài tập." });
  }

  if (!Array.isArray(asm.sharedWith)) asm.sharedWith = [];
  const currentlyShared = !!(asm.isArchivedForExaminer === true || asm.sharedWith.includes('u_phongkhaothi'));

  if (currentlyShared) {
    asm.isArchivedForExaminer = false;
    asm.sharedWith = asm.sharedWith.filter(uid => uid !== 'u_phongkhaothi');
  } else {
    asm.isArchivedForExaminer = true;
    if (!asm.sharedWith.includes('u_phongkhaothi')) {
      asm.sharedWith.push('u_phongkhaothi');
    }
  }

  writeDatabase(db);

  res.json({
    success: true,
    isArchivedForExaminer: asm.isArchivedForExaminer,
    message: asm.isArchivedForExaminer
      ? `Đã thêm bài tập "${asm.title}" vào danh sách lưu trữ của Phòng Khảo Thí thành công!`
      : `Đã gỡ bài tập "${asm.title}" khỏi danh sách lưu trữ của Phòng Khảo Thí!`
  });
});

// 5. Giáo viên xem danh sách học sinh nộp bài (Bảo mật: Chỉ giáo viên tạo bài, Admin hoặc Khảo Thí được cấp quyền mới được xem)
app.get('/api/assignments/:id/submissions', (req, res) => {
  const { id } = req.params;
  const { teacherId } = req.query;
  const db = readDatabase();

  const assignment = db.assignments.find(a => a.id === id);
  if (!assignment) {
    return res.status(404).json({ message: "Không tìm thấy bài tập." });
  }

  // BẢO VỆ: Giáo viên khác không được xem bài nộp hoặc file của bài tập này (trừ Admin hoặc Phòng Khảo Thí được phân quyền)
  if (teacherId && assignment.createdBy && assignment.createdBy !== teacherId) {
    const user = (db.users || []).find(u => u.id === teacherId);
    const isDanhOrAdmin = user && (user.isAdmin || (user.name && user.name.toLowerCase().includes('công danh')));
    const isExaminer = user && (user.isExaminer || (user.username && user.username.toLowerCase() === 'phongkhaothi'));
    const isSharedWithExaminer = assignment.isArchivedForExaminer === true || 
      (Array.isArray(assignment.sharedWith) && (assignment.sharedWith.includes(teacherId) || assignment.sharedWith.includes('u_phongkhaothi')));

    if (!isDanhOrAdmin && !(isExaminer && isSharedWithExaminer)) {
      return res.status(403).json({ message: "Bạn không có quyền xem bài tập hoặc bài nộp của giáo viên khác." });
    }
  }

  // Lọc chỉ lấy học sinh của lớp nhận bài tập
  let students = db.users.filter(u => u.role === 'student');
  if (assignment.targetClass && assignment.targetClass.toUpperCase() !== 'ALL') {
    const target = assignment.targetClass.trim().toUpperCase();
    students = students.filter(u => u.className && u.className.trim().toUpperCase() === target);
  }

  const submissions = db.submissions.filter(s => s.assignmentId === id);

  const list = students.map(student => {
    const sub = submissions.find(s => s.studentId === student.id);
    return {
      student: {
        id: student.id,
        name: student.name,
        className: student.className
      },
      hasSubmitted: !!sub,
      submission: sub || null
    };
  });

  res.json({ assignment, studentsStatus: list });
});

// 6. Học sinh nộp bài / Cập nhật bài nộp
app.post('/api/submissions', upload.single('submissionFile'), async (req, res) => {
  const { assignmentId, studentId, studentName, content, link } = req.body;

  if (!assignmentId || !studentId) {
    return res.status(400).json({ message: "Thiếu thông tin bài tập hoặc học sinh." });
  }

  const db = readDatabase();
  const assignment = db.assignments.find(a => a.id === assignmentId);
  const student = db.users.find(u => u.id === studentId);

  if (!assignment) {
    return res.status(404).json({ message: "Không tìm thấy bài tập." });
  }

  // Bảo mật: Học sinh lớp khác không được phép nộp vào bài của lớp khác
  if (assignment.targetClass && assignment.targetClass.toUpperCase() !== 'ALL') {
    if (!student || !student.className || student.className.trim().toUpperCase() !== assignment.targetClass.trim().toUpperCase()) {
      return res.status(403).json({ message: `Bài tập này chỉ dành riêng cho lớp ${assignment.targetClass}. Bạn không thể nộp bài.` });
    }
  }

  if (!content && !link && !req.file) {
    return res.status(400).json({ message: "Vui lòng nhập câu trả lời, liên kết hoặc tải lên file bài làm." });
  }

  const existingIndex = db.submissions.findIndex(
    s => s.assignmentId === assignmentId && s.studentId === studentId
  );

  let fileData = null;
  const targetClassName = assignment.targetClass || (student && student.className ? student.className : 'Chung');
  const targetSubjectName = assignment.subject || 'MonHoc';
  const assignmentTitle = assignment.title || 'BaiTap';
  const studentDisplayName = student ? (student.studentCode || student.username || student.name) : (studentName || 'HocSinh');

  if (req.file) {
    fileData = {
      filename: req.file.filename,
      originalName: decodeFileName(req.file.originalname),
      size: req.file.size
    };

    // Tải ngay lên Cloudflare R2 / Cloudinary lưu trữ đám mây vĩnh viễn (Hỗ trợ tới 100MB)
    try {
      const cloudRes = await uploadFileToCloud(req.file.path, fileData.originalName, targetClassName, targetSubjectName, req.file.size, assignmentTitle);
      if (cloudRes && cloudRes.url) {
        fileData.url = cloudRes.url;
        fileData.storageKey = cloudRes.key;
        fileData.provider = cloudRes.provider;
      }
    } catch (e) {
      console.error("[Storage] Lỗi tải file học sinh:", e.message);
    }

    // Lưu bản sao cục bộ nếu server đang chạy trên máy Mac
    saveSubmissionLocally({
      filePath: req.file.path,
      targetClass: targetClassName,
      subject: targetSubjectName,
      studentName: studentDisplayName,
      originalName: fileData.originalName,
      assignmentTitle: assignmentTitle
    });
  } else if (link || content) {
    // Nếu học sinh nộp bằng Link (Canva, Figma, Drive...) hoặc Ghi chú:
    // Tạo tệp lối tắt (.url) trên máy Mac để lưu trữ
    const tempDir = path.join(BASE_DATA_DIR, 'temp_submissions');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const safeName = studentDisplayName.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]/g, '_');
    const tempFileName = `${Date.now()}_${safeName}_BaiNop_LienKet.url`;
    const tempFilePath = path.join(tempDir, tempFileName);

    const fileContent = `[InternetShortcut]\nURL=${link || ''}\n\n[ThongTinBaiNop]\nMSSV=${student ? (student.studentCode || student.username) : ''}\nHoVaTen=${student ? student.name : ''}\nLop=${targetClassName}\nMon=${targetSubjectName}\nThoiGianNop=${new Date().toLocaleString('vi-VN')}\nLinkBaiLam=${link || ''}\nGhiChu=${content || ''}\n`;
    fs.writeFileSync(tempFilePath, fileContent, 'utf8');

    saveSubmissionLocally({
      filePath: tempFilePath,
      targetClass: targetClassName,
      subject: targetSubjectName,
      studentName: studentDisplayName,
      originalName: `${safeName}_BaiNop_LienKet.url`
    });
    try { fs.unlinkSync(tempFilePath); } catch (e) {}
  }

  const submissionTimestamp = new Date().toISOString();

  if (existingIndex >= 0) {
    if (db.submissions[existingIndex].grade !== null && db.submissions[existingIndex].grade !== undefined) {
      return res.status(400).json({ message: "Bài tập đã được chấm điểm, bạn không thể nộp lại." });
    }

    db.submissions[existingIndex].content = content ? content.trim() : "";
    db.submissions[existingIndex].link = link ? link.trim() : "";
    if (fileData) {
      db.submissions[existingIndex].file = fileData;
    }
    db.submissions[existingIndex].submittedAt = submissionTimestamp;
  } else {
    const newSubmission = {
      id: `sub_${Date.now()}`,
      assignmentId,
      studentId,
      studentName: studentDisplayName || studentName || "Học sinh",
      content: content ? content.trim() : "",
      link: link ? link.trim() : "",
      file: fileData,
      submittedAt: submissionTimestamp,
      grade: null,
      feedback: null,
      gradedAt: null
    };
    db.submissions.push(newSubmission);
  }

  // Ghi nhận thông báo nộp bài có dấu thời gian chính xác
  const targetAsm = (db.assignments || []).find(a => a.id === assignmentId);
  if (targetAsm) {
    const submitNotif = {
      id: `notif_sub_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      type: 'STUDENT_SUBMITTED',
      assignmentId: targetAsm.id,
      assignmentTitle: targetAsm.title,
      targetClass: targetClassName,
      subject: targetSubjectName,
      studentId,
      studentName: student ? student.name : studentDisplayName,
      studentCode: student ? (student.studentCode || student.username) : '',
      submittedAt: submissionTimestamp,
      createdAt: submissionTimestamp,
      readBy: []
    };
    if (!db.notifications) db.notifications = [];
    db.notifications.unshift(submitNotif);
    if (db.notifications.length > 200) db.notifications = db.notifications.slice(0, 200);
  }

  writeDatabase(db);
  res.json({ 
    success: true, 
    message: "Nộp bài tập thành công!",
    submittedAt: submissionTimestamp
  });
});

// 7. Giáo viên chấm điểm (Bảo mật: Chỉ giáo viên tạo bài mới được chấm)
app.post('/api/submissions/:id/grade', (req, res) => {
  const { id } = req.params;
  const { grade, feedback, teacherId } = req.body;

  const numGrade = parseFloat(grade);
  if (isNaN(numGrade) || numGrade < 0 || numGrade > 10) {
    return res.status(400).json({ message: "Điểm số phải là số thực từ 0.0 đến 10.0." });
  }

  const db = readDatabase();
  const sub = db.submissions.find(s => s.id === id);

  if (!sub) {
    return res.status(404).json({ message: "Không tìm thấy bài nộp." });
  }

  const assignment = db.assignments.find(a => a.id === sub.assignmentId);
  if (teacherId && assignment && assignment.createdBy && assignment.createdBy !== teacherId) {
    return res.status(403).json({ message: "Bạn không có quyền chấm điểm bài tập của giáo viên khác." });
  }

  sub.grade = Math.round(numGrade * 10) / 10;
  sub.feedback = feedback ? feedback.trim() : "";
  sub.gradedAt = new Date().toISOString();

  writeDatabase(db);
  res.json({ success: true, message: "Đã lưu điểm và nhận xét thành công!", submission: sub });
});

// 7b. Giáo viên nhập điểm trực tiếp trên bảng nộp bài tập (Từng học sinh)
app.post('/api/assignments/:assignmentId/grade-student', (req, res) => {
  const { assignmentId } = req.params;
  const { studentId, grade, feedback, teacherId } = req.body;

  const db = readDatabase();
  const assignment = db.assignments.find(a => a.id === assignmentId);
  if (!assignment) {
    return res.status(404).json({ message: "Không tìm thấy bài tập." });
  }

  if (teacherId && assignment.createdBy && assignment.createdBy !== teacherId) {
    return res.status(403).json({ message: "Bạn không có quyền chấm điểm bài tập của giáo viên khác." });
  }

  let numGrade = null;
  if (grade !== null && grade !== undefined && grade !== '') {
    numGrade = parseFloat(grade);
    if (isNaN(numGrade) || numGrade < 0 || numGrade > 10) {
      return res.status(400).json({ message: "Điểm số phải là số thực từ 0.0 đến 10.0." });
    }
    numGrade = Math.round(numGrade * 10) / 10;
  }

  let sub = db.submissions.find(s => s.assignmentId === assignmentId && s.studentId === studentId);
  if (!sub) {
    const student = db.users.find(u => u.id === studentId);
    sub = {
      id: `sub_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      assignmentId,
      studentId,
      studentName: student ? student.name : studentId,
      content: "",
      link: "",
      file: null,
      submittedAt: null,
      grade: numGrade,
      feedback: feedback ? feedback.trim() : "",
      gradedAt: new Date().toISOString()
    };
    db.submissions.push(sub);
  } else {
    sub.grade = numGrade;
    if (feedback !== undefined) {
      sub.feedback = feedback ? feedback.trim() : "";
    }
    sub.gradedAt = new Date().toISOString();
  }

  writeDatabase(db);
  res.json({ success: true, message: "Đã lưu điểm thành công!", submission: sub });
});

// 7c. Giáo viên lưu tất cả điểm trên bảng nộp bài (Batch Grade)
app.post('/api/assignments/:assignmentId/batch-grade', (req, res) => {
  const { assignmentId } = req.params;
  const { teacherId, grades } = req.body;

  if (!Array.isArray(grades)) {
    return res.status(400).json({ message: "Danh sách điểm không hợp lệ." });
  }

  const db = readDatabase();
  const assignment = db.assignments.find(a => a.id === assignmentId);
  if (!assignment) {
    return res.status(404).json({ message: "Không tìm thấy bài tập." });
  }

  if (teacherId && assignment.createdBy && assignment.createdBy !== teacherId) {
    return res.status(403).json({ message: "Bạn không có quyền chấm điểm bài tập của giáo viên khác." });
  }

  let updatedCount = 0;
  grades.forEach(item => {
    const { studentId, grade, feedback } = item;
    if (!studentId) return;

    let numGrade = null;
    if (grade !== null && grade !== undefined && grade !== '') {
      numGrade = parseFloat(grade);
      if (isNaN(numGrade) || numGrade < 0 || numGrade > 10) return;
      numGrade = Math.round(numGrade * 10) / 10;
    }

    let sub = db.submissions.find(s => s.assignmentId === assignmentId && s.studentId === studentId);
    if (!sub) {
      const student = db.users.find(u => u.id === studentId);
      sub = {
        id: `sub_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        assignmentId,
        studentId,
        studentName: student ? student.name : studentId,
        content: "",
        link: "",
        file: null,
        submittedAt: null,
        grade: numGrade,
        feedback: feedback ? feedback.trim() : "",
        gradedAt: new Date().toISOString()
      };
      db.submissions.push(sub);
      updatedCount++;
    } else {
      sub.grade = numGrade;
      if (feedback !== undefined) {
        sub.feedback = feedback ? feedback.trim() : "";
      }
      sub.gradedAt = new Date().toISOString();
      updatedCount++;
    }
  });

  writeDatabase(db);
  res.json({ success: true, message: `Đã lưu thành công ${updatedCount} điểm học sinh!`, updatedCount });
});

// ================= BẢNG ĐIỂM THÀNH PHẦN MÔN HỌC/MÔ ĐUN (THEO MẪU TRƯỜNG CĐ HÒA BÌNH XUÂN LỘC) =================

// Hàm kiểm tra quyền riêng tư: Chỉ giáo viên phụ trách môn học mới được xem/sửa bảng điểm đó
function canTeacherAccessGradeSheet(db, teacherUser, className, subjectName, existingSheet = null, allowAdminBypass = true) {
  if (!teacherUser) return false;
  // Quản trị viên (Thầy Nguyễn Công Danh) có quyền xem toàn bộ hệ thống khi cần
  if (allowAdminBypass && (teacherUser.isAdmin || teacherUser.id === 'u_teacher_danh')) {
    return true;
  }

  const cleanClass = (className || '').trim().toUpperCase();
  const cleanSubj = (subjectName || '').trim().toLowerCase();

  // 1. Kiểm tra nếu bảng điểm đã ghi nhận đúng teacherId của giáo viên này
  if (existingSheet && existingSheet.teacherId === teacherUser.id) {
    return true;
  }

  // 2. Tra cứu trong danh mục môn học (db.subjects) khớp lớp, môn và do chính giáo viên này tạo
  const matchedSubject = (db.subjects || []).find(
    s => s.className && s.className.trim().toUpperCase() === cleanClass &&
         s.name && s.name.trim().toLowerCase() === cleanSubj &&
         s.teacherId === teacherUser.id
  );
  if (matchedSubject) return true;

  // 3. Tra cứu trong danh mục bài tập (db.assignments)
  const matchedAsm = (db.assignments || []).find(
    a => a.targetClass && a.targetClass.trim().toUpperCase() === cleanClass &&
         a.subject && a.subject.trim().toLowerCase() === cleanSubj &&
         a.createdBy === teacherUser.id
  );
  if (matchedAsm) return true;

  return false;
}

// 7d. Lấy danh sách các bảng điểm hiện có (Bảo mật riêng tư: Mỗi giáo viên chỉ xem môn mình dạy)
app.get('/api/grade-sheets', (req, res) => {
  const { teacherId, viewAll } = req.query;
  const db = readDatabase();
  let sheets = db.gradeSheets || [];

  if (!teacherId) {
    return res.status(401).json({ success: false, message: "Vui lòng xác thực tài khoản giáo viên." });
  }

  const user = (db.users || []).find(u => u.id === teacherId);
  if (!user || user.role !== 'teacher') {
    return res.status(403).json({ success: false, message: "Tài khoản không có quyền truy cập giáo viên." });
  }

  const isAdmin = user.isAdmin || user.id === 'u_teacher_danh';
  if (!isAdmin || viewAll !== 'true') {
    sheets = sheets.filter(s => canTeacherAccessGradeSheet(db, user, s.className, s.subjectName, s, false));
  }

  res.json({ success: true, sheets });
});

// 7e. Lấy bảng điểm chi tiết theo Lớp & Môn học (Tự động đồng bộ tất cả học sinh đã đăng ký trong hệ thống)
app.get('/api/grade-sheets/sheet', (req, res) => {
  const { className, subjectName, teacherId, viewAll } = req.query;
  if (!className || !subjectName) {
    return res.status(400).json({ message: "Vui lòng cung cấp tên lớp và tên môn học." });
  }

  const db = readDatabase();
  const cleanClass = className.trim().toUpperCase();
  const cleanSubject = subjectName.trim();

  // Xác thực quyền Giáo viên
  const teacherUser = (db.users || []).find(u => u.id === teacherId);
  if (!teacherUser || teacherUser.role !== 'teacher') {
    return res.status(403).json({ message: "Vui lòng đăng nhập với tài khoản Giáo viên để xem bảng điểm." });
  }

  // Tìm bảng điểm đã lưu
  let sheet = (db.gradeSheets || []).find(
    s => s.className.trim().toUpperCase() === cleanClass && s.subjectName.trim().toLowerCase() === cleanSubject.toLowerCase()
  );

  // KIỂM TRA QUYỀN TRUY CẬP: Chỉ giáo viên phụ trách môn học mới được xem
  const allowBypass = viewAll === 'true' || teacherUser.isAdmin || teacherUser.id === 'u_teacher_danh';
  const hasAccess = canTeacherAccessGradeSheet(db, teacherUser, cleanClass, cleanSubject, sheet, allowBypass);
  if (!hasAccess) {
    return res.status(403).json({ 
      message: `Để đảm bảo tính riêng tư, bạn chỉ có thể xem bảng điểm của môn học do chính bạn giảng dạy. Môn "${cleanSubject}" của lớp ${cleanClass} do giáo viên khác phụ trách!` 
    });
  }

  // Lấy toàn bộ học sinh thuộc lớp này đã đăng ký trong hệ thống
  const registeredStudents = db.users.filter(
    u => u.role === 'student' && u.className && u.className.trim().toUpperCase() === cleanClass
  );

  // Sắp xếp học sinh theo mã HS (studentCode hoặc username) tăng dần
  registeredStudents.sort((a, b) => {
    const codeA = a.studentCode || a.username || '';
    const codeB = b.studentCode || b.username || '';
    return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
  });

  // Tìm giáo viên phụ trách giảng dạy môn học này
  let teacherForSubject = null;
  // Ưu tiên 1: Tra cứu trong danh sách db.subjects khớp đúng tên lớp và tên môn học
  const matchedSubject = (db.subjects || []).find(
    s => s.className && s.className.trim().toUpperCase() === cleanClass &&
         s.name && s.name.trim().toLowerCase() === cleanSubject.toLowerCase()
  );

  if (matchedSubject && matchedSubject.teacherId) {
    teacherForSubject = (db.users || []).find(u => u.id === matchedSubject.teacherId);
  }

  // Ưu tiên 2: Tra cứu bài tập thuộc lớp & môn này để lấy giáo viên tạo bài
  if (!teacherForSubject) {
    const matchedAsm = (db.assignments || []).find(
      a => a.targetClass && a.targetClass.trim().toUpperCase() === cleanClass &&
           a.subject && a.subject.trim().toLowerCase() === cleanSubject.toLowerCase() &&
           a.createdBy
    );
    if (matchedAsm) {
      teacherForSubject = (db.users || []).find(u => u.id === matchedAsm.createdBy);
    }
  }

  // Ưu tiên 3: Sử dụng teacherId truyền vào từ giáo viên đang thao tác
  if (!teacherForSubject) {
    teacherForSubject = teacherUser;
  }

  const rawTeacherName = teacherForSubject ? teacherForSubject.name : (matchedSubject ? matchedSubject.teacherName : teacherUser.name);
  const assignedTeacherName = rawTeacherName ? rawTeacherName.replace(/^(Thầy|Cô)\s+/i, '').trim() : "Nguyễn Công Danh";
  const assignedTeacherId = teacherForSubject ? teacherForSubject.id : (matchedSubject ? matchedSubject.teacherId : teacherUser.id);

  if (!sheet) {
    // Tạo bảng điểm mới chuẩn hóa theo mẫu trường CĐ Hòa Bình Xuân Lộc
    const records = registeredStudents.map((s, idx) => ({
      tt: idx + 1,
      studentId: s.id,
      studentCode: s.studentCode || s.username,
      name: capitalizeWords(s.name),
      dob: formatDob(s.dob || ""),
      hs1: null,
      hs2_1: null,
      hs2_2: null,
      hs2_3: null,
      hs2_4: null,
      note: ""
    }));

    const now = new Date();
    sheet = {
      id: `gs_${Date.now()}`,
      schoolName: "TRƯỜNG CĐ HÒA BÌNH XUÂN LỘC",
      departmentName: "KHOA MỸ THUẬT - CNTT",
      title: "BẢNG ĐIỂM THÀNH PHẦN MÔN HỌC/MÔ ĐUN",
      subjectName: cleanSubject,
      className: cleanClass,
      majorName: cleanClass.includes("MG") ? "Quản trị mạng máy tính" : "Thiết kế đồ họa",
      courseCohort: "Khóa: 15",
      totalPeriods: 45,
      credits: 2,
      academicDate: `Đồng Nai, ngày ${now.getDate()} tháng ${now.getMonth() + 1} năm ${now.getFullYear()}`,
      deanName: "Nguyễn Văn Quang",
      teacherName: assignedTeacherName,
      teacherId: assignedTeacherId,
      records: records,
      updatedAt: now.toISOString()
    };

    if (!db.gradeSheets) db.gradeSheets = [];
    db.gradeSheets.push(sheet);
    writeDatabase(db);
  } else {
    // Nếu bảng điểm đã tồn tại: Cập nhật đúng tên giáo viên giảng dạy môn học đó
    if (matchedSubject || !sheet.teacherName) {
      sheet.teacherName = assignedTeacherName;
      sheet.teacherId = assignedTeacherId;
    } else if (sheet.teacherName) {
      sheet.teacherName = sheet.teacherName.replace(/^(Thầy|Cô)\s+/i, '').trim();
    }

    if (!sheet.records) sheet.records = [];

    // Duyệt qua tất cả học sinh đã đăng ký trong hệ thống
    registeredStudents.forEach(st => {
      const targetCode = st.studentCode || st.username;
      let rec = sheet.records.find(r => 
        (st.id && r.studentId === st.id) ||
        (st.studentCode && r.studentCode && r.studentCode.toUpperCase() === st.studentCode.toUpperCase()) ||
        (r.studentCode && r.studentCode.toUpperCase() === st.username.toUpperCase())
      );
      if (!rec) {
        // Học sinh mới đăng ký -> Tự động thêm vào bảng điểm!
        sheet.records.push({
          tt: sheet.records.length + 1,
          studentId: st.id,
          studentCode: targetCode,
          name: capitalizeWords(st.name),
          dob: formatDob(st.dob || ""),
          hs1: null,
          hs2_1: null,
          hs2_2: null,
          hs2_3: null,
          hs2_4: null,
          note: ""
        });
      } else {
        // Cập nhật thông tin đồng bộ nếu user đã đổi MSSV, đổi tên hoặc ngày sinh
        if (!rec.studentId) rec.studentId = st.id;
        if (targetCode && (!rec.studentCode || rec.studentCode !== targetCode)) {
          rec.studentCode = targetCode;
        }
        rec.name = capitalizeWords(st.name || rec.name || '');
        rec.dob = formatDob(st.dob || rec.dob || '');
      }
    });

    // Chuẩn hóa tên, ngày sinh và mã HS cho toàn bộ records
    sheet.records.forEach(r => {
      if (r.name) r.name = capitalizeWords(r.name);
      if (r.dob) r.dob = formatDob(r.dob);
      if (r.studentCode) r.studentCode = r.studentCode.trim().toUpperCase();
    });

    // Sắp xếp lại records theo studentCode hoặc TT
    sheet.records.sort((a, b) => (a.studentCode || '').localeCompare(b.studentCode || '', undefined, { numeric: true, sensitivity: 'base' }));

    // Đánh số thứ tự lại từ 1 đến N
    sheet.records.forEach((r, idx) => {
      r.tt = idx + 1;
    });

    writeDatabase(db);
  }

  res.json({ success: true, sheet });
});

// 7f. Lưu toàn bộ bảng điểm thành phần
app.post('/api/grade-sheets/save', (req, res) => {
  const { sheet, teacherId } = req.body;
  if (!sheet || !sheet.className || !sheet.subjectName || !Array.isArray(sheet.records)) {
    return res.status(400).json({ message: "Dữ liệu bảng điểm không hợp lệ." });
  }

  const db = readDatabase();
  if (!db.gradeSheets) db.gradeSheets = [];

  const cleanClass = sheet.className.trim().toUpperCase();
  const cleanSubject = sheet.subjectName.trim();

  const user = (db.users || []).find(u => u.id === (teacherId || sheet.teacherId));
  if (!user || user.role !== 'teacher') {
    return res.status(403).json({ message: "Vui lòng xác thực tài khoản giáo viên trước khi lưu." });
  }

  const hasAccess = canTeacherAccessGradeSheet(db, user, cleanClass, cleanSubject, sheet, true);
  if (!hasAccess) {
    return res.status(403).json({ 
      message: `Bạn không có quyền chỉnh sửa bảng điểm môn "${cleanSubject}" vì môn này do giáo viên khác giảng dạy!` 
    });
  }

  sheet.className = cleanClass;
  sheet.subjectName = cleanSubject;
  if (sheet.teacherName) {
    sheet.teacherName = sheet.teacherName.replace(/^(Thầy|Cô)\s+/i, '').trim();
  }
  sheet.updatedAt = new Date().toISOString();

  // Cập nhật ngày sinh, MSSV và họ tên ngược lại vào danh sách users nếu giáo viên có sửa trên form
  sheet.records.forEach(r => {
    if (r.name) r.name = capitalizeWords(r.name);
    if (r.dob) r.dob = formatDob(r.dob);
    if (r.studentCode) {
      r.studentCode = r.studentCode.trim().toUpperCase();
      const u = db.users.find(user => 
        (r.studentId && user.id === r.studentId) || 
        (user.studentCode && user.studentCode.toUpperCase() === r.studentCode.toUpperCase()) || 
        user.username.toUpperCase() === r.studentCode.toUpperCase()
      );
      if (u) {
        if (r.dob) u.dob = r.dob;
        if (r.name) u.name = r.name;
        u.studentCode = r.studentCode;
      }
    }
  });

  const idx = db.gradeSheets.findIndex(
    s => s.id === sheet.id || (s.className.trim().toUpperCase() === cleanClass && s.subjectName.trim().toLowerCase() === cleanSubject.toLowerCase())
  );

  if (idx >= 0) {
    db.gradeSheets[idx] = sheet;
  } else {
    if (!sheet.id) sheet.id = `gs_${Date.now()}`;
    db.gradeSheets.push(sheet);
  }

  writeDatabase(db);
  res.json({ success: true, message: "Đã lưu bảng điểm thành công!", sheet });
});

// 7g. Lưu nhanh 1 ô điểm trong bảng điểm (Auto-save)
app.post('/api/grade-sheets/cell', (req, res) => {
  const { sheetId, studentCode, field, value, teacherId } = req.body;
  if (!sheetId || !studentCode || !field) {
    return res.status(400).json({ message: "Thiếu dữ liệu cập nhật ô." });
  }

  const db = readDatabase();
  if (!db.gradeSheets) db.gradeSheets = [];
  const sheet = db.gradeSheets.find(s => s.id === sheetId);
  if (!sheet) {
    return res.status(404).json({ message: "Không tìm thấy bảng điểm." });
  }

  if (teacherId) {
    const user = (db.users || []).find(u => u.id === teacherId);
    if (!canTeacherAccessGradeSheet(db, user, sheet.className, sheet.subjectName, sheet, true)) {
      return res.status(403).json({ message: "Bạn không có quyền chỉnh sửa bảng điểm này." });
    }
  }

  const record = sheet.records.find(r => r.studentCode === studentCode);
  if (!record) {
    return res.status(404).json({ message: "Không tìm thấy học sinh trong bảng điểm." });
  }

  if (field === 'note' || field === 'dob' || field === 'name' || field === 'studentCode') {
    let cleanVal = value ? String(value).trim() : '';
    if (field === 'name') cleanVal = capitalizeWords(cleanVal);
    if (field === 'dob') cleanVal = formatDob(cleanVal);
    if (field === 'studentCode') cleanVal = cleanVal.toUpperCase();
    record[field] = cleanVal;
    if (field === 'dob' || field === 'name' || field === 'studentCode') {
      const u = db.users.find(user => 
        (record.studentId && user.id === record.studentId) || 
        (user.studentCode && user.studentCode.toUpperCase() === studentCode.toUpperCase()) || 
        user.username.toUpperCase() === studentCode.toUpperCase()
      );
      if (u) u[field] = cleanVal;
    }
  } else {
    // Điểm số hs1, hs2_1, hs2_2, hs2_3, hs2_4
    if (value === null || value === undefined || value === '') {
      record[field] = null;
    } else {
      const num = parseFloat(value);
      if (isNaN(num) || num < 0 || num > 10) {
        return res.status(400).json({ message: "Điểm số phải từ 0 đến 10." });
      }
      record[field] = Math.round(num * 10) / 10;
    }
  }

  sheet.updatedAt = new Date().toISOString();
  writeDatabase(db);
  res.json({ success: true, record });
});

// 7h. Xóa một bảng điểm
app.delete('/api/grade-sheets/:id', (req, res) => {
  const { id } = req.params;
  const { teacherId } = req.query;
  const db = readDatabase();
  if (!db.gradeSheets) db.gradeSheets = [];
  const sheet = db.gradeSheets.find(s => s.id === id);
  if (!sheet) {
    return res.status(404).json({ message: "Không tìm thấy bảng điểm." });
  }

  if (teacherId) {
    const user = (db.users || []).find(u => u.id === teacherId);
    if (!canTeacherAccessGradeSheet(db, user, sheet.className, sheet.subjectName, sheet, true)) {
      return res.status(403).json({ message: "Bạn không có quyền xóa bảng điểm của giáo viên khác." });
    }
  }

  db.gradeSheets = db.gradeSheets.filter(s => s.id !== id);
  writeDatabase(db);
  res.json({ success: true, message: "Đã xóa bảng điểm." });
});

// =========================================================================
// PHÂN HỆ MỚI: QUẢN LÝ LỚP HỌC, GIÁO ÁN ĐIỆN TỬ, THỜI KHÓA BIỂU & ĐIỂM DANH
// (PHONG CÁCH CỔNG ĐÀO TẠO TRƯỜNG CAO ĐẲNG HÒA BÌNH XUÂN LỘC - HBXLC)
// =========================================================================

// 1. TỔNG QUAN CÁC LỚP HỌC (CLASS HUB OVERVIEW)
app.get('/api/classes/overview', (req, res) => {
  const db = readDatabase();
  const classes = db.classes || [];
  const users = db.users || [];
  const subjects = db.subjects || [];
  const assignments = db.assignments || [];
  const gradeSheets = db.gradeSheets || [];
  const lessonPlans = db.lessonPlans || [];
  const industryGroups = db.industryGroups || DEFAULT_INDUSTRY_GROUPS;

  const result = classes.map(cName => {
    const clean = cName.toUpperCase();
    const students = users.filter(u => u.role === 'student' && u.className && u.className.toUpperCase() === clean);
    const classSubjects = subjects.filter(s => s.className && s.className.toUpperCase() === clean);
    const classAssignments = assignments.filter(a => a.targetClass && (a.targetClass.toUpperCase() === clean || a.targetClass === 'ALL'));
    const classGradeSheets = gradeSheets.filter(g => g.className && g.className.toUpperCase() === clean);
    const classPlans = lessonPlans.filter(lp => lp.className && lp.className.toUpperCase() === clean);

    let group = industryGroups.find(g => (g.classes || []).map(c => c.toUpperCase()).includes(clean));
    if (!group) {
      if (clean.includes("TK")) group = industryGroups.find(g => g.id === "thiet_ke_do_hoa");
      else if (clean.includes("MA")) group = industryGroups.find(g => g.id === "may_thoi_trang");
      else group = industryGroups.find(g => g.id === "cong_nghe_thong_tin");
    }

    return {
      className: clean,
      industryGroup: group ? group.name : 'Khác',
      industryGroupId: group ? group.id : 'other',
      icon: group ? group.icon : 'fa-graduation-cap',
      color: group ? group.color : 'indigo',
      studentCount: students.length,
      subjectCount: classSubjects.length,
      subjects: classSubjects.map(s => s.name),
      assignmentCount: classAssignments.length,
      gradeSheetCount: classGradeSheets.length,
      lessonPlanCount: classPlans.length,
      completedPlans: classPlans.filter(lp => lp.status === 'completed' || lp.status === 'approved').length
    };
  });

  res.json({
    success: true,
    classes: result,
    totalClasses: classes.length,
    industryGroups: industryGroups
  });
});

// 2. GIÁO ÁN ĐIỆN TỬ (LESSON PLANS)
// 2a. Lấy danh sách giáo án
app.get('/api/lesson-plans', (req, res) => {
  const { className, subjectName, status, search, teacherId } = req.query;
  const db = readDatabase();
  let list = db.lessonPlans || [];

  if (teacherId) {
    const user = (db.users || []).find(u => u.id === teacherId);
    if (user && user.role !== 'admin' && user.role !== 'examiner') {
      list = list.filter(lp => lp.teacherId === teacherId || !lp.teacherId);
    }
  }

  if (className && className !== 'ALL') {
    list = list.filter(lp => lp.className && lp.className.toUpperCase() === className.toUpperCase());
  }
  if (subjectName && subjectName !== 'ALL') {
    list = list.filter(lp => lp.subjectName && lp.subjectName.toLowerCase() === subjectName.toLowerCase());
  }
  if (status && status !== 'ALL') {
    list = list.filter(lp => lp.status === status);
  }
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    list = list.filter(lp =>
      (lp.title && lp.title.toLowerCase().includes(q)) ||
      (lp.objectives && lp.objectives.toLowerCase().includes(q)) ||
      (lp.className && lp.className.toLowerCase().includes(q)) ||
      (lp.subjectName && lp.subjectName.toLowerCase().includes(q))
    );
  }

  // Sắp xếp: tuần tăng dần, rồi đến ngày
  list.sort((a, b) => (Number(a.week) || 0) - (Number(b.week) || 0) || new Date(b.date || 0) - new Date(a.date || 0));

  res.json({ success: true, lessonPlans: list });
});

// 2b. Thêm / Cập nhật giáo án
app.post('/api/lesson-plans', upload.single('attachment'), async (req, res) => {
  try {
    const { id, title, className, subjectName, week, periodsTheory, periodsPractice, date, objectives, content, status, notes, teacherId } = req.body;

    if (!title || !className || !subjectName) {
      return res.status(400).json({ message: "Vui lòng nhập tên bài giảng, lớp học và môn học." });
    }

    const db = readDatabase();
    if (!db.lessonPlans) db.lessonPlans = [];

    const teacher = (db.users || []).find(u => u.id === teacherId) || { id: teacherId || 'u_teacher_danh', name: 'Thầy Nguyễn Công Danh' };
    const cleanClass = className.trim().toUpperCase();
    const cleanSubject = subjectName.trim();

    ensureClassInIndustryGroup(db, cleanClass);

    let attachment = null;
    if (req.file) {
      attachment = {
        filename: req.file.filename,
        originalName: decodeFileName(req.file.originalname),
        size: req.file.size
      };
      try {
        const cloudRes = await uploadFileToCloud(req.file.path, attachment.originalName, cleanClass, cleanSubject, req.file.size, `GiaoAn_${title.trim()}`);
        if (cloudRes && cloudRes.url) {
          attachment.url = cloudRes.url;
          attachment.storageKey = cloudRes.key;
          attachment.provider = cloudRes.provider;
        }
      } catch (e) {
        console.error("[Storage] Lỗi tải file đính kèm giáo án:", e.message);
      }
    }

    if (id) {
      const idx = db.lessonPlans.findIndex(lp => lp.id === id);
      if (idx !== -1) {
        const existing = db.lessonPlans[idx];
        db.lessonPlans[idx] = {
          ...existing,
          title: title.trim(),
          className: cleanClass,
          subjectName: cleanSubject,
          week: Number(week) || 1,
          periodsTheory: Number(periodsTheory) || 0,
          periodsPractice: Number(periodsPractice) || 0,
          date: date || existing.date || new Date().toISOString().split('T')[0],
          objectives: objectives || '',
          content: content || '',
          status: status || existing.status || 'draft',
          notes: notes || '',
          attachment: attachment || existing.attachment || null,
          updatedAt: new Date().toISOString()
        };
        writeDatabase(db);
        return res.json({ success: true, lessonPlan: db.lessonPlans[idx], message: "Cập nhật giáo án thành công!" });
      }
    }

    const newPlan = {
      id: id || `lp_${Date.now()}`,
      title: title.trim(),
      className: cleanClass,
      subjectName: cleanSubject,
      week: Number(week) || 1,
      periodsTheory: Number(periodsTheory) || 0,
      periodsPractice: Number(periodsPractice) || 0,
      date: date || new Date().toISOString().split('T')[0],
      objectives: objectives || '',
      content: content || '',
      status: status || 'draft',
      notes: notes || '',
      attachment: attachment || null,
      teacherId: teacher.id,
      teacherName: teacher.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    db.lessonPlans.push(newPlan);
    writeDatabase(db);
    res.json({ success: true, lessonPlan: newPlan, message: "Tạo giáo án điện tử thành công!" });
  } catch (err) {
    console.error("Lỗi lưu giáo án:", err);
    res.status(500).json({ message: "Lỗi máy chủ khi lưu giáo án: " + err.message });
  }
});

// 2c. Cập nhật nhanh trạng thái giáo án
app.post('/api/lesson-plans/:id/status', (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;
  const db = readDatabase();
  if (!db.lessonPlans) db.lessonPlans = [];
  const plan = db.lessonPlans.find(lp => lp.id === id);
  if (!plan) return res.status(404).json({ message: "Không tìm thấy giáo án." });

  plan.status = status || plan.status;
  if (notes !== undefined) plan.notes = notes;
  plan.updatedAt = new Date().toISOString();
  writeDatabase(db);
  res.json({ success: true, lessonPlan: plan });
});

// 2d. Xóa giáo án
app.delete('/api/lesson-plans/:id', (req, res) => {
  const { id } = req.params;
  const db = readDatabase();
  if (!db.lessonPlans) db.lessonPlans = [];
  db.lessonPlans = db.lessonPlans.filter(lp => lp.id !== id);
  writeDatabase(db);
  res.json({ success: true, message: "Đã xóa giáo án." });
});

// 3. THỜI KHÓA BIỂU / LỊCH BÁO GIẢNG (SCHEDULE)
app.get('/api/schedule', (req, res) => {
  const { className } = req.query;
  const db = readDatabase();
  let list = db.schedule || [];

  if (className && className !== 'ALL') {
    list = list.filter(s => s.className && s.className.toUpperCase() === className.toUpperCase());
  }

  list.sort((a, b) => (Number(a.dayOfWeek) - Number(b.dayOfWeek)) || (a.session === 'morning' ? -1 : 1));
  res.json({ success: true, schedule: list });
});

app.post('/api/schedule', (req, res) => {
  const { id, dayOfWeek, session, periods, timeRange, className, subjectName, room, currentLesson, notes, teacherName } = req.body;
  if (!className || !subjectName || !dayOfWeek) {
    return res.status(400).json({ message: "Vui lòng nhập đầy đủ thông tin buổi học (Thứ, Lớp, Môn)." });
  }

  const db = readDatabase();
  if (!db.schedule) db.schedule = [];

  const cleanClass = className.trim().toUpperCase();
  ensureClassInIndustryGroup(db, cleanClass);

  if (id) {
    const idx = db.schedule.findIndex(s => s.id === id);
    if (idx !== -1) {
      db.schedule[idx] = {
        ...db.schedule[idx],
        dayOfWeek: Number(dayOfWeek),
        session: session || 'morning',
        periods: periods || (session === 'morning' ? '1 - 5' : '6 - 10'),
        timeRange: timeRange || (session === 'morning' ? '07:00 - 11:15' : '12:45 - 17:00'),
        className: cleanClass,
        subjectName: subjectName.trim(),
        room: room || 'Phòng máy',
        currentLesson: currentLesson || '',
        notes: notes || '',
        teacherName: teacherName || 'Thầy Nguyễn Công Danh',
        updatedAt: new Date().toISOString()
      };
      writeDatabase(db);
      return res.json({ success: true, scheduleItem: db.schedule[idx], message: "Đã cập nhật thời khóa biểu!" });
    }
  }

  const newItem = {
    id: id || `sch_${Date.now()}`,
    dayOfWeek: Number(dayOfWeek),
    session: session || 'morning',
    periods: periods || (session === 'morning' ? '1 - 5' : '6 - 10'),
    timeRange: timeRange || (session === 'morning' ? '07:00 - 11:15' : '12:45 - 17:00'),
    className: cleanClass,
    subjectName: subjectName.trim(),
    room: room || 'Phòng máy',
    currentLesson: currentLesson || '',
    notes: notes || '',
    teacherName: teacherName || 'Thầy Nguyễn Công Danh',
    createdAt: new Date().toISOString()
  };

  db.schedule.push(newItem);
  writeDatabase(db);
  res.json({ success: true, scheduleItem: newItem, message: "Đã thêm buổi dạy vào lịch báo giảng!" });
});

app.delete('/api/schedule/:id', (req, res) => {
  const { id } = req.params;
  const db = readDatabase();
  if (!db.schedule) db.schedule = [];
  db.schedule = db.schedule.filter(s => s.id !== id);
  writeDatabase(db);
  res.json({ success: true, message: "Đã xóa buổi dạy khỏi thời khóa biểu." });
});

// 4. ĐIỂM DANH LỚP HỌC (ATTENDANCE)
app.get('/api/attendance', (req, res) => {
  const { className, date } = req.query;
  const db = readDatabase();
  let list = db.attendance || [];
  if (className && className !== 'ALL') {
    list = list.filter(a => a.className && a.className.toUpperCase() === className.toUpperCase());
  }
  if (date) {
    list = list.filter(a => a.date === date);
  }
  res.json({ success: true, attendance: list });
});

app.post('/api/attendance', (req, res) => {
  const { className, subjectName, date, lessonTitle, records, teacherId } = req.body;
  if (!className || !date || !records) {
    return res.status(400).json({ message: "Dữ liệu điểm danh không hợp lệ." });
  }
  const db = readDatabase();
  if (!db.attendance) db.attendance = [];

  const cleanClass = className.trim().toUpperCase();
  const existingIdx = db.attendance.findIndex(a => a.className === cleanClass && a.date === date);

  const entry = {
    id: existingIdx !== -1 ? db.attendance[existingIdx].id : `att_${Date.now()}`,
    className: cleanClass,
    subjectName: subjectName || '',
    date: date,
    lessonTitle: lessonTitle || '',
    records: records,
    updatedAt: new Date().toISOString(),
    teacherId: teacherId || 'u_teacher_danh'
  };

  if (existingIdx !== -1) {
    db.attendance[existingIdx] = entry;
  } else {
    entry.createdAt = new Date().toISOString();
    db.attendance.push(entry);
  }

  writeDatabase(db);
  res.json({ success: true, attendance: entry, message: "Đã lưu điểm danh lớp thành công!" });
});

app.get('/api/attendance/summary/:className', (req, res) => {
  const { className } = req.params;
  const clean = className.trim().toUpperCase();
  const db = readDatabase();
  const list = (db.attendance || []).filter(a => a.className === clean);
  const users = (db.users || []).filter(u => u.role === 'student' && u.className && u.className.toUpperCase() === clean);

  const summary = users.map(u => {
    let presentCount = 0;
    let excusedCount = 0;
    let unexcusedCount = 0;

    list.forEach(session => {
      const rec = (session.records || []).find(r => r.studentId === u.id || r.studentCode === u.studentCode);
      if (rec) {
        if (rec.status === 'present') presentCount++;
        else if (rec.status === 'excused') excusedCount++;
        else if (rec.status === 'unexcused') unexcusedCount++;
      }
    });

    return {
      studentId: u.id,
      studentName: u.name,
      studentCode: u.studentCode || u.username,
      totalSessions: list.length,
      presentCount,
      excusedCount,
      unexcusedCount
    };
  });

  res.json({ success: true, className: clean, totalSessions: list.length, summary });
});

// =========================================================================
// PHÂN HỆ ĐIỂM DANH THÔNG MINH BẰNG MÃ QR & DÃY 4 SỐ (TỰ ĐỔI MÃ MỖI 1 PHÚT)
// =========================================================================

let activeAttendanceSessions = {}; // { [className]: sessionObj }

function generateRandomOtp() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function generateSessionToken() {
  return 'qr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

// Hàm kiểm tra khung giờ cho phép điểm danh học sinh theo Lịch Báo Giảng:
// - Buổi sáng: 07:00 - 11:00 (đúng ngày trong tuần của môn học)
// - Buổi chiều: 13:00 - 16:00 (đúng ngày trong tuần của môn học)
// - Ngoài khung giờ này: KHÓA học sinh tự điểm danh, chỉ cho phép Giáo viên click Checkbox để điểm danh bù.
function checkScheduleTimeWindow(scheduleItem) {
  if (!scheduleItem) return { isAllowedForStudent: true, isSameDay: true, isWithinTime: true, reason: '' };

  // Luôn lấy thời gian theo chuẩn giờ Việt Nam (UTC+7)
  const now = getVietnamNow();
  const jsDay = now.getDay(); // 0 = Chủ Nhật, 1 = Thứ Hai, ..., 6 = Thứ Bảy
  const currentDayOfWeek = jsDay === 0 ? 8 : jsDay + 1; // 2 = Thứ Hai, ..., 8 = Chủ Nhật
  const hour = now.getHours();
  const minute = now.getMinutes();
  const totalMinutes = hour * 60 + minute;

  const dayNames = { 2: 'Thứ Hai', 3: 'Thứ Ba', 4: 'Thứ Tư', 5: 'Thứ Năm', 6: 'Thứ Sáu', 7: 'Thứ Bảy', 8: 'Chủ Nhật' };
  const scheduleDay = Number(scheduleItem.dayOfWeek);
  const scheduleDayLabel = dayNames[scheduleDay] || `Thứ ${scheduleDay}`;
  const currentDayLabel = dayNames[currentDayOfWeek] || `Thứ ${currentDayOfWeek}`;

  const isMorning = Boolean(scheduleItem.session === 'morning' || (scheduleItem.periods && String(scheduleItem.periods).includes('1')));
  const allowedRangeStr = isMorning ? "07:00 - 11:00" : "13:00 - 16:00";

  // 1. Phải đúng ngày trong tuần của buổi học
  const isSameDay = (scheduleDay === currentDayOfWeek);

  // 2. Phải trong khung giờ cho phép của buổi sáng hoặc buổi chiều:
  // Ca Sáng: 7h00 - 11h00 (420 - 660 phút)
  // Ca Chiều: 13h00 - 16h00 (780 - 960 phút)
  let isWithinTime = false;
  if (isMorning) {
    isWithinTime = (totalMinutes >= 420 && totalMinutes <= 660);
  } else {
    isWithinTime = (totalMinutes >= 780 && totalMinutes <= 960);
  }

  const isAllowedForStudent = isSameDay && isWithinTime;
  let reason = '';
  if (!isSameDay) {
    reason = `Lịch học của môn diễn ra vào ${scheduleDayLabel}, trong khi hôm nay là ${currentDayLabel}.`;
  } else if (!isWithinTime) {
    const curTimeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    reason = `Hiện tại là ${curTimeStr}, ngoài khung giờ cho phép học sinh tự điểm danh (${allowedRangeStr} ${isMorning ? 'Ca Sáng' : 'Ca Chiều'}).`;
  }

  return {
    isAllowedForStudent,
    isSameDay,
    isWithinTime,
    isMorning,
    allowedRangeStr,
    scheduleDayLabel,
    currentDayLabel,
    reason
  };
}

// 4a. Giáo viên bắt đầu phiên điểm danh trực tiếp cho một lớp (BẮT BUỘC CÓ TRONG LỊCH BÁO GIẢNG)
app.post('/api/attendance/session/start', (req, res) => {
  const { className, scheduleId, subjectName, lessonTitle, teacherId } = req.body;
  if (!className) return res.status(400).json({ message: "Vui lòng chọn lớp học." });

  const cleanClass = className.trim().toUpperCase();
  const db = readDatabase();

  // 1. Kiểm tra Lịch Báo Giảng của lớp: Nếu lớp chưa có bất kỳ lịch báo giảng nào -> KHÔNG THỂ ĐIỂM DANH
  const classSchedules = (db.schedule || []).filter(s => s.className && s.className.toUpperCase() === cleanClass);
  if (classSchedules.length === 0) {
    return res.status(400).json({
      success: false,
      noSchedule: true,
      message: `Lớp ${cleanClass} chưa có môn học nào được lên lịch báo giảng! Theo quy định, Thầy cần lên thời khóa biểu tại mục Lịch Báo Giảng trước khi mở điểm danh.`
    });
  }

  // 2. Tìm môn học cụ thể trong Lịch Báo Giảng
  let matchedSchedule = null;
  if (scheduleId) {
    matchedSchedule = classSchedules.find(s => s.id === scheduleId);
  }
  if (!matchedSchedule && subjectName) {
    const cleanSub = subjectName.trim().toLowerCase();
    matchedSchedule = classSchedules.find(s => (s.subjectName || '').trim().toLowerCase() === cleanSub);
  }

  // Nếu chưa chọn môn hoặc môn không khớp trong lịch báo giảng
  if (!matchedSchedule) {
    // Nếu chỉ có duy nhất 1 môn trong lịch báo giảng thì tự động chọn môn đó
    if (classSchedules.length === 1) {
      matchedSchedule = classSchedules[0];
    } else {
      return res.status(400).json({
        success: false,
        requireSubjectSelection: true,
        availableSchedules: classSchedules,
        message: `Lớp ${cleanClass} có nhiều môn trong Lịch Báo Giảng. Vui lòng chọn môn học cụ thể để bắt đầu điểm danh!`
      });
    }
  }

  const finalSubjectName = matchedSchedule.subjectName;
  const finalLessonTitle = lessonTitle || matchedSchedule.currentLesson || `Buổi học ngày ${new Date().toLocaleDateString('vi-VN')}`;
  const finalRoom = matchedSchedule.room || '';
  const finalPeriods = matchedSchedule.periods || '';

  const users = db.users || [];
  const classStudents = users
    .filter(u => u.role === 'student' && u.className && u.className.toUpperCase() === cleanClass)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));

  const now = Date.now();
  const otp = generateRandomOtp();
  const token = generateSessionToken();
  const timeStatus = checkScheduleTimeWindow(matchedSchedule);

  const session = {
    id: `attsess_${now}`,
    className: cleanClass,
    subjectName: finalSubjectName,
    scheduleId: matchedSchedule.id,
    dayOfWeek: matchedSchedule.dayOfWeek,
    session: matchedSchedule.session,
    room: finalRoom,
    periods: finalPeriods,
    lessonTitle: finalLessonTitle,
    teacherId: teacherId || 'u_teacher_danh',
    otp: otp,
    token: token,
    createdAt: now,
    lastRefreshAt: now,
    expiresAt: now + (60 * 1000), // 60 giây (1 phút)
    rotationIntervalSeconds: 60,
    totalStudents: classStudents.length,
    checkedInStudents: {},
    isActive: true,
    isAllowedForStudent: timeStatus.isAllowedForStudent,
    timeStatus: timeStatus
  };

  activeAttendanceSessions[cleanClass] = session;
  res.json({ success: true, session });
});

// 4b. Lấy trạng thái phiên điểm danh trực tiếp (dùng cho cả màn hình Giáo viên và Học sinh)
app.get('/api/attendance/session/current', (req, res) => {
  const { className, studentId } = req.query;
  if (!className) return res.status(400).json({ message: "Thiếu tên lớp." });
  const cleanClass = className.trim().toUpperCase();
  const session = activeAttendanceSessions[cleanClass];

  if (!session || !session.isActive) {
    return res.json({ success: true, active: false });
  }

  const now = Date.now();
  // Tự động xoay mã sau mỗi 60 giây
  if (now >= session.expiresAt) {
    session.otp = generateRandomOtp();
    session.token = generateSessionToken();
    session.lastRefreshAt = now;
    session.expiresAt = now + (session.rotationIntervalSeconds * 1000);
  }

  const timeLeft = Math.max(0, Math.ceil((session.expiresAt - now) / 1000));
  const db = readDatabase();
  const users = db.users || [];
  const classStudents = users
    .filter(u => u.role === 'student' && u.className && u.className.toUpperCase() === cleanClass)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));

  const studentList = classStudents.map((stu, index) => {
    const checkin = session.checkedInStudents[stu.id];
    return {
      stt: index + 1,
      id: stu.id,
      studentCode: stu.studentCode || stu.username,
      name: stu.name,
      isChecked: !!checkin,
      checkedInAt: checkin ? checkin.checkedInAt : null,
      method: checkin ? checkin.method : null
    };
  });

  const checkedInCount = Object.keys(session.checkedInStudents || {}).length;

  let isStudentCheckedIn = false;
  let studentCheckinInfo = null;
  if (studentId && session.checkedInStudents[studentId]) {
    isStudentCheckedIn = true;
    studentCheckinInfo = session.checkedInStudents[studentId];
  }

  // Kiểm tra khung giờ điểm danh học sinh
  const matchedSchedule = (db.schedule || []).find(s => s.id === session.scheduleId) || session;
  const timeStatus = checkScheduleTimeWindow(matchedSchedule);
  session.isAllowedForStudent = session.forceUnlock ? true : timeStatus.isAllowedForStudent;
  session.timeStatus = timeStatus;

  res.json({
    success: true,
    active: true,
    session: {
      id: session.id,
      className: session.className,
      subjectName: session.subjectName,
      scheduleId: session.scheduleId,
      dayOfWeek: session.dayOfWeek,
      session: session.session,
      room: session.room,
      periods: session.periods,
      lessonTitle: session.lessonTitle,
      otp: session.otp,
      token: session.token,
      expiresAt: session.expiresAt,
      timeLeft: timeLeft,
      rotationIntervalSeconds: session.rotationIntervalSeconds,
      totalStudents: classStudents.length,
      checkedInCount: checkedInCount,
      students: studentList,
      isStudentCheckedIn,
      studentCheckinInfo,
      isAllowedForStudent: session.isAllowedForStudent,
      timeStatus: timeStatus
    }
  });
});

// Endpoint cho phép giáo viên chủ động mở khóa phiên điểm danh cho học sinh khi cần
app.post('/api/attendance/session/force-unlock', (req, res) => {
  const { className } = req.body;
  if (!className) return res.status(400).json({ message: "Thiếu tên lớp." });
  const cleanClass = className.trim().toUpperCase();
  const session = activeAttendanceSessions[cleanClass];
  if (!session || !session.isActive) {
    return res.status(404).json({ message: "Không tìm thấy phiên điểm danh." });
  }
  session.forceUnlock = true;
  session.isAllowedForStudent = true;
  res.json({ success: true, message: "Đã mở khóa phiên điểm danh cho học sinh!", session });
});

// 4c. Đổi mã ngay lập tức (Refresh OTP & QR)
app.post('/api/attendance/session/refresh-code', (req, res) => {
  const { className } = req.body;
  if (!className) return res.status(400).json({ message: "Thiếu tên lớp." });
  const cleanClass = className.trim().toUpperCase();
  const session = activeAttendanceSessions[cleanClass];

  if (!session || !session.isActive) {
    return res.status(404).json({ message: "Không có phiên điểm danh đang mở cho lớp này." });
  }

  const now = Date.now();
  session.otp = generateRandomOtp();
  session.token = generateSessionToken();
  session.lastRefreshAt = now;
  session.expiresAt = now + (session.rotationIntervalSeconds * 1000);

  res.json({
    success: true,
    otp: session.otp,
    token: session.token,
    expiresAt: session.expiresAt,
    timeLeft: session.rotationIntervalSeconds
  });
});

// 4d. Học sinh quét QR hoặc nhập 4 số để xác nhận có mặt
app.post('/api/attendance/session/checkin', (req, res) => {
  const { className, studentId, studentCode, studentName, codeOrToken } = req.body;
  if (!className || !studentId || !codeOrToken) {
    return res.status(400).json({ message: "Vui lòng nhập đầy đủ thông tin điểm danh." });
  }

  const cleanClass = className.trim().toUpperCase();
  const session = activeAttendanceSessions[cleanClass];

  if (!session || !session.isActive) {
    return res.status(400).json({ message: "Phiên điểm danh của lớp chưa bắt đầu hoặc đã kết thúc!" });
  }

  // KIỂM TRA KHUNG GIỜ HỌC SINH THEO LỊCH BÁO GIẢNG: Sáng 7h-11h, Chiều 13h-16h (đúng ngày trong tuần)
  const db = readDatabase();
  const matchedSchedule = (db.schedule || []).find(s => s.id === session.scheduleId) || session;
  const timeStatus = checkScheduleTimeWindow(matchedSchedule);

  if (!timeStatus.isAllowedForStudent && !session.forceUnlock) {
    return res.status(400).json({
      success: false,
      locked: true,
      message: `Đã khóa chức năng tự điểm danh của học sinh! Buổi học theo lịch báo giảng chỉ cho phép học sinh điểm danh ${timeStatus.allowedRangeStr} (${timeStatus.isMorning ? 'Ca Sáng' : 'Ca Chiều'}) vào ${timeStatus.scheduleDayLabel}. ${timeStatus.reason} Vui lòng báo Thầy giáo để được điểm danh bù qua Checkbox!`
    });
  }

  const cleanInput = codeOrToken.trim();
  const isMatchOtp = (cleanInput === session.otp);
  const isMatchToken = (cleanInput === session.token || cleanInput.includes(session.token) || cleanInput.includes(session.otp));

  if (!isMatchOtp && !isMatchToken) {
    return res.status(400).json({
      message: "Mã điểm danh không chính xác hoặc đã hết hạn 1 phút! Vui lòng nhìn lên màn hình thầy giáo để lấy mã mới."
    });
  }

  if (session.checkedInStudents[studentId]) {
    return res.json({
      success: true,
      alreadyCheckedIn: true,
      message: "Bạn đã được ghi nhận có mặt trước đó!",
      checkedInAt: session.checkedInStudents[studentId].checkedInAt
    });
  }

  const now = new Date();
  const checkinRecord = {
    studentId,
    studentCode: studentCode || '',
    studentName: studentName || 'Học sinh',
    checkedInAt: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    timestamp: now.getTime(),
    method: isMatchOtp ? 'pin_4_digit' : 'qr_scanner'
  };

  session.checkedInStudents[studentId] = checkinRecord;

  res.json({
    success: true,
    message: `Điểm danh thành công! Đã ghi nhận bạn có mặt lúc ${checkinRecord.checkedInAt}.`,
    record: checkinRecord
  });
});

// 4e. Giáo viên tự tay tích / bỏ tích Checkbox cho học sinh
app.post('/api/attendance/session/manual-toggle', (req, res) => {
  const { className, studentId, studentCode, studentName, isChecked } = req.body;
  if (!className || !studentId) return res.status(400).json({ message: "Thiếu thông tin học sinh." });
  const cleanClass = className.trim().toUpperCase();
  const session = activeAttendanceSessions[cleanClass];

  if (!session || !session.isActive) {
    return res.status(400).json({ message: "Phiên điểm danh không còn hiệu lực." });
  }

  if (isChecked) {
    const now = new Date();
    session.checkedInStudents[studentId] = {
      studentId,
      studentCode: studentCode || '',
      studentName: studentName || '',
      checkedInAt: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      timestamp: now.getTime(),
      method: 'teacher_manual'
    };
  } else {
    delete session.checkedInStudents[studentId];
  }

  res.json({ success: true, isChecked: !!session.checkedInStudents[studentId] });
});

// 4f. Giáo viên kết thúc phiên & chốt sổ điểm danh lưu vào Database (KÈM THỐNG KÊ VẮNG MẶT MÔN HỌC)
app.post('/api/attendance/session/close', (req, res) => {
  const { className } = req.body;
  if (!className) return res.status(400).json({ message: "Thiếu tên lớp." });
  const cleanClass = className.trim().toUpperCase();
  const session = activeAttendanceSessions[cleanClass];

  if (!session) {
    return res.status(404).json({ message: "Không tìm thấy phiên điểm danh đang hoạt động." });
  }

  session.isActive = false;

  const db = readDatabase();
  if (!db.attendance) db.attendance = [];

  const users = db.users || [];
  const classStudents = users.filter(u => u.role === 'student' && u.className && u.className.toUpperCase() === cleanClass);
  const dateStr = new Date().toISOString().split('T')[0];

  const records = classStudents.map(stu => {
    const isChecked = !!session.checkedInStudents[stu.id];
    return {
      studentId: stu.id,
      studentCode: stu.studentCode || stu.username,
      studentName: stu.name,
      status: isChecked ? 'present' : null, // null nếu học sinh chưa quét hoặc chưa nhập mã (vắng mặt)
      checkedInAt: isChecked ? session.checkedInStudents[stu.id].checkedInAt : null,
      method: isChecked ? session.checkedInStudents[stu.id].method : null
    };
  });

  const attendanceEntry = {
    id: `att_${Date.now()}`,
    className: cleanClass,
    subjectName: session.subjectName,
    scheduleId: session.scheduleId || null,
    room: session.room || '',
    periods: session.periods || '',
    date: dateStr,
    lessonTitle: session.lessonTitle,
    records: records,
    createdAt: new Date().toISOString(),
    teacherId: session.teacherId,
    type: 'qr_4digit_live'
  };

  db.attendance.push(attendanceEntry);
  writeDatabase(db);

  // ================= TÍNH TOÁN THỐNG KÊ CHUYÊN CẦN MÔN HỌC =================
  // Lấy toàn bộ các buổi điểm danh của môn này đối với lớp cleanClass (đã bao gồm buổi vừa lưu)
  const allSubjectSessions = (db.attendance || []).filter(a =>
    a.className && a.className.toUpperCase() === cleanClass &&
    a.subjectName && a.subjectName.trim().toLowerCase() === session.subjectName.trim().toLowerCase()
  );
  const totalSubjectSessions = allSubjectSessions.length;

  const presentStudents = [];
  const absentStudents = [];

  classStudents.forEach((stu, index) => {
    const isChecked = !!session.checkedInStudents[stu.id];
    if (isChecked) {
      presentStudents.push({
        stt: index + 1,
        id: stu.id,
        studentCode: stu.studentCode || stu.username,
        name: stu.name,
        checkedInAt: session.checkedInStudents[stu.id].checkedInAt,
        method: session.checkedInStudents[stu.id].method
      });
    } else {
      // Học sinh VẮNG trong buổi học hôm nay -> Thống kê tổng số buổi đã nghỉ ở môn này
      let totalAbsentInSubject = 0;
      allSubjectSessions.forEach(sess => {
        const r = (sess.records || []).find(rec => rec.studentId === stu.id || rec.studentCode === (stu.studentCode || stu.username));
        // Nếu không có bản ghi hoặc status không phải là 'present' thì tính là vắng
        if (!r || r.status !== 'present') {
          totalAbsentInSubject++;
        }
      });

      const absentPercent = totalSubjectSessions > 0 ? Math.round((totalAbsentInSubject / totalSubjectSessions) * 100) : 0;
      // Cảnh báo nếu vắng từ 3 buổi hoặc vắng >= 20% tổng số buổi của môn
      const isWarning = totalAbsentInSubject >= 3 || absentPercent >= 20;

      absentStudents.push({
        stt: index + 1,
        id: stu.id,
        studentCode: stu.studentCode || stu.username,
        name: stu.name,
        totalAbsentInSubject,
        totalSubjectSessions,
        absentPercent,
        isWarning
      });
    }
  });

  delete activeAttendanceSessions[cleanClass];

  res.json({
    success: true,
    message: `Đã chốt sổ điểm danh môn "${session.subjectName}" lớp ${cleanClass}!`,
    attendanceEntry,
    summary: {
      className: cleanClass,
      subjectName: session.subjectName,
      lessonTitle: session.lessonTitle,
      room: session.room,
      periods: session.periods,
      date: dateStr,
      totalStudents: classStudents.length,
      presentCount: presentStudents.length,
      absentCount: absentStudents.length,
      totalSubjectSessions,
      absentStudents,
      presentStudents
    }
  });
});

// 4g. Lấy báo cáo chuyên cần tổng hợp theo môn học và lớp
app.get('/api/attendance/subject-summary', (req, res) => {
  const { className, subjectName } = req.query;
  if (!className || !subjectName) {
    return res.status(400).json({ message: "Thiếu tên lớp hoặc tên môn học." });
  }
  const cleanClass = className.trim().toUpperCase();
  const cleanSubject = subjectName.trim().toLowerCase();
  const db = readDatabase();

  const sessions = (db.attendance || []).filter(a =>
    a.className && a.className.toUpperCase() === cleanClass &&
    a.subjectName && a.subjectName.trim().toLowerCase() === cleanSubject
  );

  const users = db.users || [];
  const classStudents = users
    .filter(u => u.role === 'student' && u.className && u.className.toUpperCase() === cleanClass)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));

  const report = classStudents.map((stu, index) => {
    let absentCount = 0;
    let presentCount = 0;

    sessions.forEach(sess => {
      const r = (sess.records || []).find(rec => rec.studentId === stu.id || rec.studentCode === (stu.studentCode || stu.username));
      if (r && r.status === 'present') {
        presentCount++;
      } else {
        absentCount++;
      }
    });

    const totalSessions = sessions.length;
    const absentPercent = totalSessions > 0 ? Math.round((absentCount / totalSessions) * 100) : 0;
    const isWarning = absentCount >= 3 || absentPercent >= 20;

    return {
      stt: index + 1,
      id: stu.id,
      studentCode: stu.studentCode || stu.username,
      name: stu.name,
      presentCount,
      absentCount,
      totalSessions,
      absentPercent,
      isWarning
    };
  });

  res.json({
    success: true,
    className: cleanClass,
    subjectName: subjectName,
    totalSessions: sessions.length,
    students: report
  });
});

// 4h. Lấy danh sách lịch báo giảng của một lớp cụ thể kèm nhận diện buổi học hôm nay
app.get('/api/schedule/for-class/:className', (req, res) => {
  const { className } = req.params;
  if (!className) return res.status(400).json({ message: "Thiếu tên lớp." });
  const cleanClass = className.trim().toUpperCase();
  const db = readDatabase();

  const list = (db.schedule || []).filter(s => s.className && s.className.toUpperCase() === cleanClass);
  // Ngày trong tuần hiện tại theo giờ Việt Nam (UTC+7): 0 = CN, 1 = T2, 2 = T3, ..., 6 = T7. Lịch báo giảng: 2 = T2, 3 = T3, ..., 7 = T7.
  const nowVn = getVietnamNow();
  const todayJsDay = nowVn.getDay(); // 0-6
  const currentDayOfWeek = todayJsDay === 0 ? 8 : todayJsDay + 1;

  const result = list.map(item => {
    const timeStatus = checkScheduleTimeWindow(item);
    return {
      ...item,
      isToday: Number(item.dayOfWeek) === currentDayOfWeek,
      isAllowedForStudent: timeStatus.isAllowedForStudent,
      timeStatus: timeStatus
    };
  });

  // Sắp xếp: Tiết đang trong giờ học sinh lên trước, sau đó tiết hôm nay, sau đó theo thứ trong tuần
  result.sort((a, b) => {
    if (a.isAllowedForStudent && !b.isAllowedForStudent) return -1;
    if (!a.isAllowedForStudent && b.isAllowedForStudent) return 1;
    if (a.isToday && !b.isToday) return -1;
    if (!a.isToday && b.isToday) return 1;
    return (Number(a.dayOfWeek) - Number(b.dayOfWeek)) || (a.session === 'morning' ? -1 : 1);
  });

  res.json({
    success: true,
    className: cleanClass,
    hasSchedule: result.length > 0,
    schedules: result
  });
});

// Hàm hỗ trợ tìm kiếm URL đám mây của file (Tra cứu CSDL và Auto-Recovery trên Cloudinary)
async function findCloudUrlForFile(filename, db) {
  if (!filename) return null;
  const decodedName = decodeURIComponent(filename);
  const cleanBase = filename.replace(/\.[^/.]+$/, "").replace(/^\d+_/, "");

  // 1. Tìm chính xác trong submissions
  for (const s of (db.submissions || [])) {
    if (s.file && (s.file.filename === filename || s.file.originalName === filename || s.file.filename === decodedName || s.file.originalName === decodedName)) {
      if (s.file.url) return s.file.url;
    }
  }

  // 2. Tìm chính xác trong assignments (file đính kèm đề bài)
  for (const a of (db.assignments || [])) {
    if (a.attachment && (a.attachment.filename === filename || a.attachment.originalName === filename || a.attachment.filename === decodedName || a.attachment.originalName === decodedName)) {
      if (a.attachment.url) return a.attachment.url;
    }
  }

  // 2b. Tìm trong giáo án điện tử (file đính kèm giáo án)
  for (const lp of (db.lessonPlans || [])) {
    if (lp.attachment && (lp.attachment.filename === filename || lp.attachment.originalName === filename || lp.attachment.filename === decodedName || lp.attachment.originalName === decodedName)) {
      if (lp.attachment.url) return lp.attachment.url;
    }
  }

  // 3. Tìm tương đối trong submissions và assignments (nếu có URL chứa tên file)
  if (cleanBase.length > 3) {
    for (const s of (db.submissions || [])) {
      if (s.file && s.file.url) {
        if (s.file.url.includes(cleanBase) || s.file.url.includes(encodeURIComponent(cleanBase))) {
          return s.file.url;
        }
      }
    }
    for (const a of (db.assignments || [])) {
      if (a.attachment && a.attachment.url) {
        if (a.attachment.url.includes(cleanBase) || a.attachment.url.includes(encodeURIComponent(cleanBase))) {
          return a.attachment.url;
        }
      }
    }
  }

  // 4. Tra cứu trực tiếp trên Cloudflare R2 (Auto-Recovery qua R2 API)
  if (r2Client) {
    try {
      const r2List = await r2Client.send(new ListObjectsV2Command({
        Bucket: R2_BUCKET_NAME,
        Prefix: 'educlass_submissions/'
      }));
      const match = (r2List.Contents || []).find(c => {
        const k = c.Key || '';
        return k.includes(filename) || k.includes(decodedName) || (cleanBase.length > 3 && (k.includes(cleanBase) || k.includes(encodeURIComponent(cleanBase))));
      });
      if (match) {
        const publicUrl = `${R2_PUBLIC_DOMAIN.replace(/\/$/, '')}/${match.Key}`;
        console.log(`[Cloud Auto-Recovery] ⚡ Đã tìm thấy file "${filename}" trên Cloudflare R2: ${publicUrl}`);
        for (const s of (db.submissions || [])) {
          if (s.file && !s.file.url && (s.file.filename === filename || s.file.originalName === filename || s.file.filename === decodedName || s.file.originalName === decodedName)) {
            s.file.url = publicUrl;
            s.file.storageKey = match.Key;
            s.file.provider = 'r2';
            writeDatabase(db);
            break;
          }
        }
        return publicUrl;
      }
    } catch (err) {
      console.error('[Cloud Auto-Recovery R2 Error]:', err.message);
    }
  }

  // 5. Tra cứu trực tiếp trên Cloudinary (Auto-Recovery qua Cloudinary API nếu CSDL bị mất URL)
  if (cloudinary) {
    try {
      const resCloud = await cloudinary.api.resources({
        resource_type: 'raw',
        type: 'upload',
        prefix: 'educlass_submissions/',
        max_results: 500
      });
      const match = (resCloud.resources || []).find(r => {
        const pid = r.public_id || '';
        return pid.includes(filename) || pid.includes(decodedName) || (cleanBase.length > 3 && (pid.includes(cleanBase) || pid.includes(encodeURIComponent(cleanBase))));
      });
      if (match) {
        console.log(`[Cloud Auto-Recovery] ☁️ Đã tìm thấy file "${filename}" trên Cloudinary: ${match.secure_url}`);
        // Tự động khôi phục URL cho submission nếu chưa có
        for (const s of (db.submissions || [])) {
          if (s.file && !s.file.url && (s.file.filename === filename || s.file.originalName === filename || s.file.filename === decodedName || s.file.originalName === decodedName)) {
            s.file.url = match.secure_url;
            s.file.publicId = match.public_id;
            writeDatabase(db);
            break;
          }
        }
        return match.secure_url;
      }
    } catch (err) {
      console.error('[Cloud Auto-Recovery Error]:', err.message);
    }
  }

  return null;
}

// 8. Tải tệp tin
app.get('/api/download/:filename', async (req, res) => {
  const { filename } = req.params;
  const downloadName = req.query.name || filename;
  const filePath = path.join(UPLOAD_DIR, filename);

  if (fs.existsSync(filePath)) {
    return res.download(filePath, downloadName);
  }

  // Nếu file vật lý không còn trên ổ cứng tạm của Render, tìm URL lưu trên Cloudinary
  const db = readDatabase();
  const cloudUrl = await findCloudUrlForFile(filename, db);

  if (cloudUrl) {
    return res.redirect(cloudUrl);
  }

  // Trang thông báo thân thiện giải thích nếu tệp tin bị xoá trên ổ cứng tạm
  return res.status(404).send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Thông Báo Tệp Tin - EduClass</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    </head>
    <body class="bg-slate-100 flex items-center justify-center min-h-screen p-4 font-sans">
      <div class="bg-white max-w-lg w-full p-8 rounded-2xl shadow-xl text-center space-y-4 border border-slate-200">
        <div class="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto text-2xl shadow-sm">
          <i class="fa-solid fa-cloud-exclamation"></i>
        </div>
        <h2 class="text-xl font-bold text-slate-800">Tệp Tin Không Còn Trên Máy Chủ Tạm</h2>
        <p class="text-sm text-slate-600 leading-relaxed">
          Tệp tin <span class="font-semibold text-slate-800 break-all">${filename}</span> không còn tồn tại trên ổ cứng tạm của máy chủ (do Render tự động giải phóng bộ nhớ khi khởi động lại).
        </p>
        <div class="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 text-left space-y-1">
          <div class="font-bold flex items-center gap-1.5"><i class="fa-solid fa-shield-check text-emerald-600"></i> Dữ liệu học vụ an toàn 100%:</div>
          <div>Mọi thông tin nộp bài, điểm số, nhận xét và danh sách học sinh vẫn được lưu trữ vĩnh viễn trên Cơ sở dữ liệu MongoDB Atlas.</div>
        </div>
        <div class="pt-2">
          <button onclick="window.history.back()" class="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-md transition inline-flex items-center gap-2">
            <i class="fa-solid fa-arrow-left"></i> Quay lại trang trước
          </button>
        </div>
      </div>
    </body>
    </html>
  `);
});

// 8b. Xem nội dung file trực tiếp trên Web (Xem Inline / Preview)
app.get('/api/raw-file/:filename', async (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(UPLOAD_DIR, filename);

  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }

  const db = readDatabase();
  const cloudUrl = await findCloudUrlForFile(filename, db);

  if (cloudUrl) {
    return res.redirect(cloudUrl);
  }

  return res.status(404).send("Tệp tin không tồn tại trên hệ thống.");
});

// 8c. Đọc nội dung file dạng văn bản / mã nguồn để hiển thị trực tiếp
app.get('/api/file-text/:filename', async (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(UPLOAD_DIR, filename);

  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return res.json({ success: true, content, size: fs.statSync(filePath).size });
    } catch (err) {
      return res.status(500).json({ error: "Không thể đọc nội dung văn bản: " + err.message });
    }
  }

  const db = readDatabase();
  const cloudUrl = await findCloudUrlForFile(filename, db);
  if (cloudUrl) {
    try {
      const fetchRes = await fetch(cloudUrl);
      if (fetchRes.ok) {
        const content = await fetchRes.text();
        return res.json({ success: true, content, size: content.length });
      }
    } catch (e) {}
  }

  return res.status(404).json({ error: "Tệp tin không tồn tại." });
});

// 8d. Tải toàn bộ bài nộp của 1 bài tập dưới dạng file ZIP (gom theo lớp và môn, tự động lấy từ Đám mây nếu file cục bộ không có)
app.get('/api/assignments/:id/download-all-zip', async (req, res) => {
  const { id } = req.params;
  const { teacherId } = req.query;
  const db = readDatabase();
  const AdmZip = require('adm-zip');

  const asm = (db.assignments || []).find(a => a.id === id);
  if (!asm) {
    return res.status(404).send("Bài tập không tồn tại.");
  }

  // Bảo vệ: Chỉ người tạo, Admin hoặc Phòng Khảo Thí được cấp quyền mới được tải zip
  if (teacherId && asm.createdBy && asm.createdBy !== teacherId) {
    const user = (db.users || []).find(u => u.id === teacherId);
    const isDanhOrAdmin = user && (user.isAdmin || (user.name && user.name.toLowerCase().includes('công danh')));
    const isExaminer = user && (user.isExaminer || (user.username && user.username.toLowerCase() === 'phongkhaothi'));
    const isSharedWithExaminer = asm.isArchivedForExaminer === true || 
      (Array.isArray(asm.sharedWith) && (asm.sharedWith.includes(teacherId) || asm.sharedWith.includes('u_phongkhaothi')));

    if (!isDanhOrAdmin && !(isExaminer && isSharedWithExaminer)) {
      return res.status(403).send("Bạn không có quyền tải toàn bộ bài nộp của bài tập này.");
    }
  }

  const submissions = (db.submissions || []).filter(s => s.assignmentId === id);
  if (submissions.length === 0) {
    return res.status(400).send("Chưa có học sinh nào nộp bài cho bài tập này.");
  }

  const zip = new AdmZip();
  const cleanClass = sanitizeFolderName(asm.targetClass || 'Chung');
  const cleanSubject = sanitizeFolderName(asm.subject || 'MonHoc');
  const cleanAssignment = sanitizeFolderName(asm.title || 'BaiTap');
  const folderPath = `${cleanClass}/${cleanSubject}/${cleanAssignment}`;

  let fileCount = 0;

  for (const sub of submissions) {
    const student = (db.users || []).find(u => u.id === sub.studentId);
    const studentCode = student ? (student.studentCode || student.username || '') : '';
    const studentName = student ? student.name : (sub.studentName || 'HocSinh');
    const safeStudentName = studentName.replace(/[/\\?%*:|"<>]/g, '_');
    const prefix = studentCode ? `${studentCode}_${safeStudentName}` : safeStudentName;

    if (sub.file && sub.file.filename) {
      const filePath = path.join(UPLOAD_DIR, sub.file.filename);
      let fileAdded = false;

      // 1. Thử đọc file từ ổ cứng cục bộ
      if (fs.existsSync(filePath)) {
        try {
          const destName = `${prefix}_${sub.file.originalName}`;
          zip.addLocalFile(filePath, folderPath, destName);
          fileCount++;
          fileAdded = true;
        } catch (e) {}
      }

      // 2. Nếu không có file vật lý (trên Render Cloud), tải trực tiếp từ Cloud (Cloudflare R2 / Cloudinary)
      if (!fileAdded) {
        const cloudUrl = sub.file.url || await findCloudUrlForFile(sub.file.filename, db);
        if (cloudUrl) {
          try {
            const fetchRes = await fetch(cloudUrl);
            if (fetchRes.ok) {
              const arrayBuf = await fetchRes.arrayBuffer();
              const destName = `${prefix}_${sub.file.originalName || sub.file.filename}`;
              zip.addFile(`${folderPath}/${destName}`, Buffer.from(arrayBuf));
              fileCount++;
              fileAdded = true;
            }
          } catch (err) {
            console.warn(`[Zip Export] Lỗi kéo file từ Cloud (${cloudUrl}):`, err.message);
          }
        }
      }

      // 3. Dự phòng nếu tải file cloud thất bại: tạo file Shortcut .url
      if (!fileAdded && (sub.file.url || sub.link)) {
        const directUrl = sub.file.url || sub.link;
        const urlContent = `[InternetShortcut]\nURL=${directUrl}\n\n[ThongTinBaiNop]\nMSSV=${studentCode}\nHoVaTen=${studentName}\nLop=${cleanClass}\nMon=${cleanSubject}\nBaiTap=${cleanAssignment}\nLinkCloud=${directUrl}\n`;
        zip.addFile(`${folderPath}/${prefix}_LienKetCloud.url`, Buffer.from(urlContent, 'utf8'));
        fileCount++;
      }
    } else if (sub.link || sub.content) {
      const urlContent = `[InternetShortcut]\nURL=${sub.link || ''}\n\n[ThongTinBaiNop]\nMSSV=${studentCode}\nHoVaTen=${studentName}\nLop=${cleanClass}\nMon=${cleanSubject}\nBaiTap=${cleanAssignment}\nThoiGianNop=${sub.submittedAt || ''}\nLink=${sub.link || ''}\nGhiChu=${sub.content || ''}\n`;
      zip.addFile(`${folderPath}/${prefix}_LienKet.url`, Buffer.from(urlContent, 'utf8'));
      fileCount++;
    }
  }

  if (fileCount === 0) {
    return res.status(404).send("Không tìm thấy file bài nộp nào trên hệ thống.");
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const zipFileName = `BaiNop_${cleanClass}_${cleanSubject}_${cleanAssignment}_${dateStr}.zip`;
  const buffer = zip.toBuffer();

  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(zipFileName)}"`,
    'Content-Length': buffer.length
  });
  res.send(buffer);
});

// 8e. Tải toàn bộ bài nộp của TẤT CẢ các lớp/môn dưới dạng file ZIP
app.get('/api/admin/download-all-submissions-zip', async (req, res) => {
  const db = readDatabase();
  const AdmZip = require('adm-zip');

  const submissions = (db.submissions || []).filter(s => s.file || s.link);
  if (submissions.length === 0) {
    return res.status(400).send("Chưa có bài nộp nào trên hệ thống.");
  }

  const zip = new AdmZip();
  let fileCount = 0;

  for (const sub of submissions) {
    const asm = (db.assignments || []).find(a => a.id === sub.assignmentId);
    const cleanClass = sanitizeFolderName(asm ? asm.targetClass : 'Chung');
    const cleanSubject = sanitizeFolderName(asm ? asm.subject : 'MonHoc');
    const cleanAssignment = sanitizeFolderName(asm ? asm.title : 'BaiTap');
    const folderPath = `${cleanClass}/${cleanSubject}/${cleanAssignment}`;

    const student = (db.users || []).find(u => u.id === sub.studentId);
    const studentCode = student ? (student.studentCode || student.username || '') : '';
    const studentName = student ? student.name : (sub.studentName || 'HocSinh');
    const safeStudentName = studentName.replace(/[/\\?%*:|"<>]/g, '_');
    const prefix = studentCode ? `${studentCode}_${safeStudentName}` : safeStudentName;

    if (sub.file && sub.file.filename) {
      const filePath = path.join(UPLOAD_DIR, sub.file.filename);
      let fileAdded = false;

      if (fs.existsSync(filePath)) {
        try {
          const destName = `${prefix}_${sub.file.originalName}`;
          zip.addLocalFile(filePath, folderPath, destName);
          fileCount++;
          fileAdded = true;
        } catch (e) {}
      }

      if (!fileAdded) {
        const cloudUrl = sub.file.url || await findCloudUrlForFile(sub.file.filename, db);
        if (cloudUrl) {
          try {
            const fetchRes = await fetch(cloudUrl);
            if (fetchRes.ok) {
              const arrayBuf = await fetchRes.arrayBuffer();
              const destName = `${prefix}_${sub.file.originalName || sub.file.filename}`;
              zip.addFile(`${folderPath}/${destName}`, Buffer.from(arrayBuf));
              fileCount++;
              fileAdded = true;
            }
          } catch (err) {}
        }
      }

      if (!fileAdded && (sub.file.url || sub.link)) {
        const directUrl = sub.file.url || sub.link;
        const urlContent = `[InternetShortcut]\nURL=${directUrl}\n\n[ThongTinBaiNop]\nMSSV=${studentCode}\nHoVaTen=${studentName}\nLop=${cleanClass}\nMon=${cleanSubject}\nBaiTap=${cleanAssignment}\nLinkCloud=${directUrl}\n`;
        zip.addFile(`${folderPath}/${prefix}_LienKetCloud.url`, Buffer.from(urlContent, 'utf8'));
        fileCount++;
      }
    } else if (sub.link || sub.content) {
      const urlContent = `[InternetShortcut]\nURL=${sub.link || ''}\n\n[ThongTinBaiNop]\nMSSV=${studentCode}\nHoVaTen=${studentName}\nLop=${cleanClass}\nMon=${cleanSubject}\nBaiTap=${cleanAssignment}\nThoiGianNop=${sub.submittedAt || ''}\nLink=${sub.link || ''}\nGhiChu=${sub.content || ''}\n`;
      zip.addFile(`${folderPath}/${prefix}_LienKet.url`, Buffer.from(urlContent, 'utf8'));
      fileCount++;
    }
  }

  if (fileCount === 0) {
    return res.status(404).send("Không tìm thấy file bài nộp nào.");
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const zipFileName = `ToanBo_BaiNop_${dateStr}.zip`;
  const buffer = zip.toBuffer();

  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(zipFileName)}"`,
    'Content-Length': buffer.length
  });
  res.send(buffer);
});

// 8d. API lấy URL công khai hỗ trợ xem trước Office & Google Docs
app.get('/api/server-info', (req, res) => {
  let tunnelUrl = process.env.PUBLIC_URL || '';
  if (!tunnelUrl) {
    try {
      const taskLogPath = path.join(os.homedir(), '.gemini/antigravity/brain/5342ff79-e5cb-4601-9053-9b81109b3f8b/.system_generated/tasks/task-74.log');
      if (fs.existsSync(taskLogPath)) {
        const logContent = fs.readFileSync(taskLogPath, 'utf8');
        const matches = logContent.match(/https:\/\/[a-zA-Z0-9.-]*\.trycloudflare\.com/g);
        if (matches && matches.length > 0) {
          tunnelUrl = matches[matches.length - 1];
        }
      }
    } catch (e) {}
  }
  
  const host = req.get('host');
  const protocol = req.protocol;
  const currentOrigin = `${protocol}://${host}`;
  
  res.json({
    currentOrigin,
    publicUrl: tunnelUrl || currentOrigin
  });
});

// 8e. API Luồng thông báo đẩy thời gian thực (SSE) cho thiết bị học sinh
app.get('/api/notifications/stream', (req, res) => {
  const { studentId, className } = req.query;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) res.flushHeaders();

  const clientId = `client_${Date.now()}_${Math.random()}`;
  const client = {
    id: clientId,
    res,
    studentId: studentId || null,
    className: (className || '').trim().toUpperCase()
  };
  sseClients.add(client);

  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', message: 'Đã kết nối thông báo thời gian thực' })}\n\n`);

  req.on('close', () => {
    sseClients.delete(client);
  });
});

// 8f. Lấy danh sách thông báo của học sinh theo Lớp
app.get('/api/notifications', (req, res) => {
  const { studentId, className } = req.query;
  const db = readDatabase();
  const allNotifs = db.notifications || [];

  if (!className) {
    return res.json({ success: true, notifications: [], unreadCount: 0 });
  }

  const cleanClass = className.trim().toUpperCase();
  // CHỈ LẤY THÔNG BÁO CHO ĐÚNG LỚP NÀY (HOẶC ALL)
  const classNotifs = allNotifs.filter(
    n => n.targetClass === 'ALL' || (n.targetClass && n.targetClass.trim().toUpperCase() === cleanClass)
  );

  const formatted = classNotifs.map(n => ({
    ...n,
    isRead: Array.isArray(n.readBy) && studentId ? n.readBy.includes(studentId) : false
  }));

  const unreadCount = formatted.filter(n => !n.isRead).length;
  res.json({ success: true, notifications: formatted, unreadCount });
});

// 8g. Đánh dấu thông báo đã đọc
app.post('/api/notifications/mark-read', (req, res) => {
  const { studentId, notificationId, all, className } = req.body;
  if (!studentId) return res.status(400).json({ message: "Thiếu studentId" });

  const db = readDatabase();
  if (!db.notifications) db.notifications = [];

  if (all && className) {
    const cleanClass = className.trim().toUpperCase();
    db.notifications.forEach(n => {
      if (n.targetClass === 'ALL' || (n.targetClass && n.targetClass.trim().toUpperCase() === cleanClass)) {
        if (!Array.isArray(n.readBy)) n.readBy = [];
        if (!n.readBy.includes(studentId)) n.readBy.push(studentId);
      }
    });
  } else if (notificationId) {
    const notif = db.notifications.find(n => n.id === notificationId);
    if (notif) {
      if (!Array.isArray(notif.readBy)) notif.readBy = [];
      if (!notif.readBy.includes(studentId)) notif.readBy.push(studentId);
    }
  }

  writeDatabase(db);
  res.json({ success: true, message: "Đã cập nhật trạng thái thông báo" });
});

// 9. API Mở thư mục lưu trữ bài nộp trên máy Mac
app.get('/api/cloud-sync-status', (req, res) => {
  res.json({ 
    localDir: MAC_LOCAL_DIR,
    isAvailable: fs.existsSync(MAC_LOCAL_DIR)
  });
});

app.post('/api/open-cloud-folder', (req, res) => {
  const { exec } = require('child_process');
  if (!fs.existsSync(MAC_LOCAL_DIR)) {
    try {
      fs.mkdirSync(MAC_LOCAL_DIR, { recursive: true });
    } catch (e) {}
  }
  exec(`open "${MAC_LOCAL_DIR}"`);
  return res.json({ success: true, message: `Đã mở thư mục EduClass_BaiTap trên máy Mac!` });
});

// API Thực thi lệnh "npm run sync-mac" trực tiếp từ giao diện Web
app.post('/api/admin/sync-mac', (req, res) => {
  const isMac = process.platform === 'darwin';

  if (!isMac) {
    return res.json({
      success: false,
      isCloud: true,
      isMac: false,
      message: "Máy chủ hiện đang chạy trên nền tảng đám mây Render (Linux) nên không thể ghi file trực tiếp vào ổ cứng macOS của bạn.",
      suggestion: "Bạn có thể dùng nút 'Tải Bài Nộp (.ZIP)' để tải toàn bộ bài nộp về máy Mac dạng nén, hoặc mở web tại địa chỉ nội bộ của máy Mac (http://localhost:3000) để chạy lệnh đồng bộ tự động."
    });
  }

  const { exec } = require('child_process');
  const projectDir = __dirname;

  // Thực thi script node sync-to-mac.js (tương đương npm run sync-mac)
  exec('node sync-to-mac.js', { cwd: projectDir, maxBuffer: 15 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      console.error('[Sync-Mac Lỗi]:', error);
      return res.json({
        success: false,
        isCloud: false,
        isMac: true,
        message: 'Có lỗi trong quá trình thực thi: ' + error.message,
        stdout: stdout || '',
        stderr: stderr || error.message
      });
    }

    return res.json({
      success: true,
      isCloud: false,
      isMac: true,
      message: 'Đã hoàn tất đồng bộ bài nộp về máy Mac!',
      stdout: stdout || 'Đồng bộ hoàn tất.'
    });
  });
});

// 10. API Tải về bản sao lưu dữ liệu toàn hệ thống (Backup CSDL data.json)
app.get('/api/admin/export-database', (req, res) => {
  if (!fs.existsSync(DATA_FILE)) {
    return res.status(404).json({ message: "Chưa có file dữ liệu" });
  }
  const dateStr = new Date().toISOString().split('T')[0];
  res.download(DATA_FILE, `educlass_backup_${dateStr}.json`);
});

// 11. Tự động hóa công việc xóa file trên Cloudinary sau 60 ngày tính từ ngày kết thúc nhiệm vụ (dueDate)
let cleanupExpiredFiles = async () => ({ deletedFilesCount: 0 });
try {
  const mod = require('./cleanup-cloudinary-expired');
  if (mod && mod.cleanupExpiredFiles) cleanupExpiredFiles = mod.cleanupExpiredFiles;
} catch (e) {
  console.warn('[Server] Bỏ qua tác vụ dọn dẹp định kỳ (không tìm thấy module cleanup-cloudinary-expired):', e.message);
}

// API Kích hoạt dọn dẹp file Cloudinary quá hạn 60 ngày (Chỉ Quản trị viên)
app.post('/api/admin/cleanup-expired-files', async (req, res) => {
  const { adminId } = req.body;
  const db = readDatabase();
  const caller = (db.users || []).find(u => u.id === adminId);
  if (!caller || (!caller.isAdmin && caller.id !== 'u_teacher_danh')) {
    return res.status(403).json({ message: "Chỉ Quản trị viên (Thầy Nguyễn Công Danh) mới có quyền kích hoạt dọn dẹp tệp tin!" });
  }

  try {
    const result = await cleanupExpiredFiles();
    // Tải lại memoryCache sau khi cleanup cập nhật CSDL
    if (mongoDbCollection) {
      const cloudDoc = await mongoDbCollection.findOne({ id: 'main' });
      if (cloudDoc) {
        delete cloudDoc._id;
        memoryCache = cloudDoc;
      }
    }
    res.json({ success: true, message: "Đã hoàn tất quá trình quét & dọn dẹp file quá hạn 60 ngày trên Cloudinary!", result });
  } catch (err) {
    res.status(500).json({ success: false, message: "Lỗi dọn dẹp: " + err.message });
  }
});

// Tiến trình tự động chạy ngầm trên máy chủ mỗi 24 giờ
async function runAutoCloudinaryCleanup() {
  try {
    console.log('[Cloudinary Cleanup Cron] 🕒 Đang kiểm tra định kỳ các bài tập quá hạn 60 ngày...');
    const res = await cleanupExpiredFiles();
    if (res && res.deletedFilesCount > 0) {
      console.log(`[Cloudinary Cleanup Cron] 🧹 Đã tự động xóa ${res.deletedFilesCount} file quá hạn 60 ngày trên Cloudinary!`);
    }
  } catch (err) {
    console.error('[Cloudinary Cleanup Cron] Lỗi kiểm tra:', err.message);
  }
}

// Khởi chạy sau 15 giây khi server bật, lặp lại mỗi 24 giờ
setTimeout(runAutoCloudinaryCleanup, 15000);
setInterval(runAutoCloudinaryCleanup, 24 * 60 * 60 * 1000);

// Khởi động server (Lắng nghe trên toàn bộ địa chỉ 0.0.0.0 để máy khác trong mạng truy cập được)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 EDUCLASS SERVER ĐANG CHẠY TẠI: http://localhost:${PORT}`);
  console.log(`🌐 MẠNG NỘI BỘ (LAN/Wi-Fi): http://192.168.1.131:${PORT}`);
  console.log(`=======================================================`);
});
