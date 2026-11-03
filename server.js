const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { isDriveApiConfigured, uploadToGoogleDrive, setupAndShareSubjectFolder } = require('./googleDrive');

const app = express();
const PORT = process.env.PORT || 3000;

// Thư mục lưu trữ dữ liệu và tệp tin tải lên
const DATA_FILE = path.join(__dirname, 'data.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Tự động tạo thư mục uploads nếu chưa có
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

// Cấu hình đồng bộ tự động lên Đám mây (Google Drive / OneDrive)
// Mỗi bài nộp sẽ lưu vào Thư mục cha: [Tên Lớp] -> Thư mục con: [Tên Môn Học]
const CLOUD_SYNC_ROOTS = [
  {
    provider: "gdrive",
    name: "Google Drive",
    path: "/Users/Danh/Library/CloudStorage/GoogleDrive-josepdanh@gmail.com/Drive của tôi/EduClass_BaiTap"
  },
  {
    provider: "onedrive",
    name: "OneDrive",
    path: "/Users/Danh/Library/CloudStorage/OneDrive-Personal/EduClass_BaiTap"
  }
];

function sanitizeFolderName(name) {
  if (!name) return 'Chung';
  return name.trim().replace(/[/\\?%*:|"<>]/g, '_');
}

async function syncFileToCloudStorage({ filePath, targetClass, subject, studentName, originalName, mimeType }) {
  if (!filePath || !fs.existsSync(filePath)) return null;

  const cleanClass = sanitizeFolderName(targetClass);
  const cleanSubject = sanitizeFolderName(subject);
  const cleanStudent = sanitizeFolderName(studentName);
  const cleanOriginal = sanitizeFolderName(originalName);

  const formattedFileName = `${cleanStudent}_${cleanOriginal}`;
  let driveResult = null;

  // 1. Tải lên trực tiếp Google Drive qua Google Drive API (Hoạt động trên cả Render.com và Máy Mac)
  if (isDriveApiConfigured()) {
    try {
      driveResult = await uploadToGoogleDrive({
        filePath,
        fileName: formattedFileName,
        targetClass: cleanClass,
        subject: cleanSubject,
        mimeType
      });
      if (driveResult) {
        console.log(`[Google Drive API] ✅ Đã lưu file "${formattedFileName}" lên Google Drive!`);
      }
    } catch (apiErr) {
      console.error('[Google Drive API Lỗi]:', apiErr.message);
    }
  }

  // 2. Đồng bộ vào ứng dụng Google Drive / OneDrive Desktop cục bộ trên máy Mac (nếu có)
  CLOUD_SYNC_ROOTS.forEach(cloud => {
    try {
      const parentDir = path.dirname(cloud.path);
      if (fs.existsSync(parentDir)) {
        // Thư mục cha: Tên Lớp | Thư mục con: Môn Học
        const destFolder = path.join(cloud.path, cleanClass, cleanSubject);
        if (!fs.existsSync(destFolder)) {
          fs.mkdirSync(destFolder, { recursive: true });
        }
        const destFilePath = path.join(destFolder, formattedFileName);
        fs.copyFileSync(filePath, destFilePath);
        console.log(`[Cloud Sync - ${cloud.name}] Đã đồng bộ bài tập vào: ${destFilePath}`);
      }
    } catch (err) {
      console.error(`[Cloud Sync - ${cloud.name} Lỗi]:`, err.message);
    }
  });

  return driveResult;
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
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

// Middleware
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

// Đọc và ghi CSDL file JSON
function readDatabase() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2), 'utf8');
    return JSON.parse(JSON.stringify(initialData));
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!data.gradeSheets) data.gradeSheets = [];
    if (!data.subjects) data.subjects = [];
    if (!data.classes) data.classes = [];
    return data;
  } catch (err) {
    console.error("Lỗi đọc database. Khôi phục dữ liệu ban đầu:", err);
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2), 'utf8');
    return JSON.parse(JSON.stringify(initialData));
  }
}

function writeDatabase(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Khởi tạo DB khi bắt đầu
readDatabase();

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

  const db = readDatabase();
  const norm = (str) => (str || '').toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "d")
    .replace(/\s+/g, "");

  const cleanInputUser = norm(username);
  const cleanInputPass = password.trim();

  // Tìm người dùng: hỗ trợ không phân biệt hoa thường, có dấu tiếng Việt, có/không khoảng trắng
  const user = db.users.find(u => {
    const dbUserNorm = norm(u.username);
    const dbNameNorm = norm(u.name);
    const userMatch = (
      u.username.trim().toLowerCase() === username.trim().toLowerCase() ||
      dbUserNorm === cleanInputUser ||
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
  const { username, password, name, role, className, subject, email, dob } = req.body;
  if (!username || !password || !name || !role) {
    return res.status(400).json({ message: "Vui lòng điền đầy đủ các thông tin bắt buộc." });
  }

  const db = readDatabase();
  const existing = db.users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
  if (existing) {
    return res.status(400).json({ message: "Tên đăng nhập này đã tồn tại, vui lòng chọn tên khác." });
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

// 1c. Quản lý danh mục Lớp học
app.get('/api/classes', (req, res) => {
  const db = readDatabase();
  const classesFromUsers = db.users
    .filter(u => u.role === 'student' && u.className)
    .map(u => u.className.trim().toUpperCase());
  const definedClasses = (db.classes || []).map(c => c.trim().toUpperCase());
  const allUnique = Array.from(new Set([...definedClasses, ...classesFromUsers])).filter(Boolean).sort();
  res.json({ classes: allUnique });
});

// CHỈ ADMIN (Thầy Nguyễn Công Danh) MỚI CÓ QUYỀN TẠO THÊM LỚP HỌC MỚI
app.post('/api/classes', (req, res) => {
  const { name, adminId } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ message: "Vui lòng nhập tên lớp học." });
  }

  const db = readDatabase();
  const admin = db.users.find(u => u.id === adminId && u.isAdmin);
  if (!admin) {
    return res.status(403).json({ 
      message: "Chỉ Quản trị viên (Thầy Nguyễn Công Danh) mới có quyền tạo thêm lớp học mới! Các giáo viên khác chỉ chọn lớp và tự tạo môn học cho lớp đó." 
    });
  }

  const cleanName = name.trim().toUpperCase();
  if (!db.classes) db.classes = [];
  if (!db.classes.map(c => c.toUpperCase()).includes(cleanName)) {
    db.classes.push(cleanName);
    writeDatabase(db);
  }
  res.json({ success: true, message: `Đã tạo lớp ${cleanName} thành công!`, className: cleanName });
});

// 1e. Quản lý Môn học (Giáo viên tự tạo môn học cho từng lớp)
app.get('/api/subjects', (req, res) => {
  const { className, teacherId } = req.query;
  const db = readDatabase();
  let subjects = db.subjects || [];

  if (className && className !== 'ALL') {
    subjects = subjects.filter(s => s.className.toUpperCase() === className.toUpperCase());
  }
  if (teacherId) {
    subjects = subjects.filter(s => s.teacherId === teacherId);
  }

  res.json({ subjects });
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

  // Tự động tạo thư mục và chia sẻ quyền truy cập Google Drive nếu giáo viên có email
  let driveInfo = null;
  if (isDriveApiConfigured() && teacher.email) {
    try {
      driveInfo = await setupAndShareSubjectFolder({
        targetClass: cleanClassName,
        subject: cleanSubjectName,
        teacherEmail: teacher.email
      });
    } catch (e) {
      console.error("[Subject Drive Setup Error]:", e.message);
    }
  }

  const newSubject = {
    id: `subj_${Date.now()}`,
    name: cleanSubjectName,
    className: cleanClassName,
    teacherId: teacher.id,
    teacherName: teacher.name,
    teacherEmail: teacher.email || null,
    driveFolderId: driveInfo ? driveInfo.subjectFolderId : null,
    driveLink: driveInfo ? driveInfo.driveLink : null,
    createdAt: new Date().toISOString()
  };

  db.subjects.push(newSubject);
  writeDatabase(db);

  let successMsg = `Đã tạo môn học "${cleanSubjectName}" cho lớp ${cleanClassName} thành công!`;
  if (teacher.email) {
    successMsg += ` Thư mục môn học đã được tự động cấp quyền truy cập trên Google Drive tới email: ${teacher.email}`;
  }

  res.json({ 
    success: true, 
    message: successMsg, 
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
  const { studentId, teacherId, teacherFilterClass } = req.query;
  const db = readDatabase();

  let targetAssignments = db.assignments;

  // PHÂN QUYỀN HỌC SINH: Học sinh chỉ thấy bài tập của đúng lớp mình (hoặc giao chung ALL)
  if (studentId) {
    const student = db.users.find(u => u.id === studentId);
    if (student && student.className) {
      const studentClass = student.className.trim().toUpperCase();
      targetAssignments = db.assignments.filter(asm => {
        if (!asm.targetClass || asm.targetClass.toUpperCase() === 'ALL') return true;
        return asm.targetClass.trim().toUpperCase() === studentClass;
      });
    }
  } else if (teacherId) {
    // BẢO VỆ PHÂN QUYỀN GIÁO VIÊN: Giáo viên CHỈ xem được bài tập do CHÍNH MÌNH tạo ra!
    targetAssignments = db.assignments.filter(asm => asm.createdBy === teacherId);

    // Nếu giáo viên chọn lọc theo 1 lớp cụ thể
    if (teacherFilterClass && teacherFilterClass !== 'ALL') {
      const filterClass = teacherFilterClass.trim().toUpperCase();
      targetAssignments = targetAssignments.filter(asm => {
        return asm.targetClass && asm.targetClass.trim().toUpperCase() === filterClass;
      });
    }
  }

  const result = targetAssignments.map(asm => {
    const submissions = db.submissions.filter(s => s.assignmentId === asm.id);
    const submittedCount = submissions.length;
    const gradedCount = submissions.filter(s => s.grade !== null && s.grade !== undefined).length;

    // Tìm thông tin giáo viên tạo bài để hiển thị cho học sinh
    const teacher = db.users.find(u => u.id === asm.createdBy);
    const teacherName = teacher ? teacher.name : 'Giáo viên';
    const teacherSubject = teacher ? teacher.subject : '';

    // Tính sĩ số chuẩn theo từng lớp được giao bài tập
    let totalStudents = db.users.filter(u => u.role === 'student').length;
    if (asm.targetClass && asm.targetClass.toUpperCase() !== 'ALL') {
      totalStudents = db.users.filter(u => 
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

    return {
      ...asm,
      targetClass: asm.targetClass || 'ALL',
      subject: asm.subject || teacherSubject || 'Tin học',
      teacherName,
      teacherSubject,
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
app.post('/api/assignments', upload.single('attachment'), (req, res) => {
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
    if (!db.classes) db.classes = [];
    if (!db.classes.map(c => c.toUpperCase()).includes(cleanTargetClass)) {
      db.classes.push(cleanTargetClass);
    }

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
        createdAt: new Date().toISOString()
      });
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
    attachment: req.file ? {
      filename: req.file.filename,
      originalName: decodeFileName(req.file.originalname),
      size: req.file.size
    } : null,
    createdBy: teacherId || "u_teacher_danh"
  };

  // Đồng bộ đề bài lên Google Drive / OneDrive
  if (req.file) {
    syncFileToCloudStorage({
      filePath: req.file.path,
      targetClass: cleanTargetClass,
      subject: cleanSubject,
      studentName: 'DE_BAI',
      originalName: decodeFileName(req.file.originalname),
      mimeType: req.file.mimetype
    }).catch(e => console.error("Cloud sync assignment error:", e));
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

// 4. Giáo viên xóa bài tập (Chỉ người tạo mới được xóa)
app.delete('/api/assignments/:id', (req, res) => {
  const { id } = req.params;
  const { teacherId } = req.query;
  const db = readDatabase();

  const target = db.assignments.find(a => a.id === id);
  if (!target) {
    return res.status(404).json({ message: "Không tìm thấy bài tập cần xóa." });
  }

  if (teacherId && target.createdBy && target.createdBy !== teacherId) {
    return res.status(403).json({ message: "Bạn không có quyền xóa bài tập của giáo viên khác." });
  }

  db.assignments = db.assignments.filter(a => a.id !== id);
  db.submissions = db.submissions.filter(s => s.assignmentId !== id);
  if (db.notifications) {
    db.notifications = db.notifications.filter(n => n.assignmentId !== id);
  }

  writeDatabase(db);
  res.json({ success: true, message: "Đã xóa bài tập thành công." });
});

// 5. Giáo viên xem danh sách học sinh nộp bài (Bảo mật: Chỉ giáo viên tạo bài mới được xem bài nộp & file)
app.get('/api/assignments/:id/submissions', (req, res) => {
  const { id } = req.params;
  const { teacherId } = req.query;
  const db = readDatabase();

  const assignment = db.assignments.find(a => a.id === id);
  if (!assignment) {
    return res.status(404).json({ message: "Không tìm thấy bài tập." });
  }

  // BẢO VỆ: Giáo viên khác không được xem bài nộp hoặc file của bài tập này
  if (teacherId && assignment.createdBy && assignment.createdBy !== teacherId) {
    return res.status(403).json({ message: "Bạn không có quyền xem bài tập hoặc bài nộp của giáo viên khác." });
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
app.post('/api/submissions', upload.single('submissionFile'), (req, res) => {
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
  if (req.file) {
    fileData = {
      filename: req.file.filename,
      originalName: decodeFileName(req.file.originalname),
      size: req.file.size
    };

    // Tự động phân loại và đồng bộ lên Google Drive & OneDrive
    // Thư mục cha: [Tên Lớp] -> Thư mục con: [Tên Môn Học]
    const targetClassName = assignment.targetClass || (student && student.className ? student.className : 'Chung');
    const targetSubjectName = assignment.subject || 'MonHoc';
    const studentDisplayName = student ? (student.username || student.name) : (studentName || 'HocSinh');

    syncFileToCloudStorage({
      filePath: req.file.path,
      targetClass: targetClassName,
      subject: targetSubjectName,
      studentName: studentDisplayName,
      originalName: fileData.originalName,
      mimeType: req.file.mimetype
    }).catch(e => console.error("Cloud sync submission error:", e));
  }

  if (existingIndex >= 0) {
    if (db.submissions[existingIndex].grade !== null && db.submissions[existingIndex].grade !== undefined) {
      return res.status(400).json({ message: "Bài tập đã được chấm điểm, bạn không thể nộp lại." });
    }

    db.submissions[existingIndex].content = content ? content.trim() : "";
    db.submissions[existingIndex].link = link ? link.trim() : "";
    if (fileData) {
      db.submissions[existingIndex].file = fileData;
    }
    db.submissions[existingIndex].submittedAt = new Date().toISOString();
  } else {
    const newSubmission = {
      id: `sub_${Date.now()}`,
      assignmentId,
      studentId,
      studentName: studentName || "Học sinh",
      content: content ? content.trim() : "",
      link: link ? link.trim() : "",
      file: fileData,
      submittedAt: new Date().toISOString(),
      grade: null,
      feedback: null,
      gradedAt: null
    };
    db.submissions.push(newSubmission);
  }

  writeDatabase(db);
  res.json({ success: true, message: "Nộp bài tập thành công!" });
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
      submittedAt: new Date().toISOString(),
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
        submittedAt: new Date().toISOString(),
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

// 7d. Lấy danh sách các bảng điểm hiện có
app.get('/api/grade-sheets', (req, res) => {
  const { teacherId } = req.query;
  const db = readDatabase();
  let sheets = db.gradeSheets || [];
  if (teacherId) {
    sheets = sheets.filter(s => !s.teacherId || s.teacherId === teacherId);
  }
  res.json({ success: true, sheets });
});

// 7e. Lấy bảng điểm chi tiết theo Lớp & Môn học (Tự động đồng bộ tất cả học sinh đã đăng ký trong hệ thống)
app.get('/api/grade-sheets/sheet', (req, res) => {
  const { className, subjectName, teacherId } = req.query;
  if (!className || !subjectName) {
    return res.status(400).json({ message: "Vui lòng cung cấp tên lớp và tên môn học." });
  }

  const db = readDatabase();
  const cleanClass = className.trim().toUpperCase();
  const cleanSubject = subjectName.trim();

  // Tìm bảng điểm đã lưu
  let sheet = (db.gradeSheets || []).find(
    s => s.className.trim().toUpperCase() === cleanClass && s.subjectName.trim().toLowerCase() === cleanSubject.toLowerCase()
  );

  // Lấy toàn bộ học sinh thuộc lớp này đã đăng ký trong hệ thống
  const registeredStudents = db.users.filter(
    u => u.role === 'student' && u.className && u.className.trim().toUpperCase() === cleanClass
  );

  // Sắp xếp học sinh theo mã HS / username tăng dần
  registeredStudents.sort((a, b) => (a.username || '').localeCompare(b.username || ''));

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

  // Ưu tiên 3: Sử dụng teacherId truyền vào từ giáo viên đang thao tác (nếu có)
  if (!teacherForSubject && teacherId) {
    teacherForSubject = (db.users || []).find(u => u.id === teacherId && u.role === 'teacher');
  }

  // Ưu tiên 4: Mặc định lấy giáo viên đầu tiên trong hệ thống
  if (!teacherForSubject) {
    teacherForSubject = (db.users || []).find(u => u.role === 'teacher');
  }

  const rawTeacherName = teacherForSubject ? teacherForSubject.name : (matchedSubject ? matchedSubject.teacherName : "Nguyễn Công Danh");
  const assignedTeacherName = rawTeacherName ? rawTeacherName.replace(/^(Thầy|Cô)\s+/i, '').trim() : "Nguyễn Công Danh";
  const assignedTeacherId = teacherForSubject ? teacherForSubject.id : (matchedSubject ? matchedSubject.teacherId : (teacherId || "u_teacher_danh"));

  if (!sheet) {
    // Tạo bảng điểm mới chuẩn hóa theo mẫu trường CĐ Hòa Bình Xuân Lộc
    const records = registeredStudents.map((s, idx) => ({
      tt: idx + 1,
      studentId: s.id,
      studentCode: s.username,
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
      let rec = sheet.records.find(r => r.studentCode === st.username || r.studentId === st.id);
      if (!rec) {
        // Học sinh mới đăng ký -> Tự động thêm vào bảng điểm!
        sheet.records.push({
          tt: sheet.records.length + 1,
          studentId: st.id,
          studentCode: st.username,
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
        // Cập nhật thông tin đồng bộ nếu user đã đổi tên hoặc ngày sinh (luôn viết hoa chữ cái đầu và chuẩn hóa ngày sinh)
        rec.name = capitalizeWords(st.name || rec.name || '');
        rec.dob = formatDob(st.dob || rec.dob || '');
        if (!rec.studentId) rec.studentId = st.id;
      }
    });

    // Chuẩn hóa tên và ngày sinh cho toàn bộ records
    sheet.records.forEach(r => {
      if (r.name) r.name = capitalizeWords(r.name);
      if (r.dob) r.dob = formatDob(r.dob);
    });

    // Sắp xếp lại records theo studentCode hoặc TT
    sheet.records.sort((a, b) => (a.studentCode || '').localeCompare(b.studentCode || ''));

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
  const { sheet } = req.body;
  if (!sheet || !sheet.className || !sheet.subjectName || !Array.isArray(sheet.records)) {
    return res.status(400).json({ message: "Dữ liệu bảng điểm không hợp lệ." });
  }

  const db = readDatabase();
  if (!db.gradeSheets) db.gradeSheets = [];

  const cleanClass = sheet.className.trim().toUpperCase();
  const cleanSubject = sheet.subjectName.trim();

  sheet.className = cleanClass;
  sheet.subjectName = cleanSubject;
  if (sheet.teacherName) {
    sheet.teacherName = sheet.teacherName.replace(/^(Thầy|Cô)\s+/i, '').trim();
  }
  sheet.updatedAt = new Date().toISOString();

  // Cập nhật ngày sinh và họ tên ngược lại vào danh sách users nếu giáo viên có sửa trên form
  sheet.records.forEach(r => {
    if (r.name) r.name = capitalizeWords(r.name);
    if (r.dob) r.dob = formatDob(r.dob);
    if (r.studentCode) {
      const u = db.users.find(user => user.username === r.studentCode);
      if (u) {
        if (r.dob) u.dob = r.dob;
        if (r.name) u.name = r.name;
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
  const { sheetId, studentCode, field, value } = req.body;
  if (!sheetId || !studentCode || !field) {
    return res.status(400).json({ message: "Thiếu dữ liệu cập nhật ô." });
  }

  const db = readDatabase();
  if (!db.gradeSheets) db.gradeSheets = [];
  const sheet = db.gradeSheets.find(s => s.id === sheetId);
  if (!sheet) {
    return res.status(404).json({ message: "Không tìm thấy bảng điểm." });
  }

  const record = sheet.records.find(r => r.studentCode === studentCode);
  if (!record) {
    return res.status(404).json({ message: "Không tìm thấy học sinh trong bảng điểm." });
  }

  if (field === 'note' || field === 'dob' || field === 'name') {
    let cleanVal = value ? String(value).trim() : '';
    if (field === 'name') cleanVal = capitalizeWords(cleanVal);
    if (field === 'dob') cleanVal = formatDob(cleanVal);
    record[field] = cleanVal;
    if (field === 'dob' || field === 'name') {
      const u = db.users.find(user => user.username === studentCode);
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
  const db = readDatabase();
  if (!db.gradeSheets) db.gradeSheets = [];
  db.gradeSheets = db.gradeSheets.filter(s => s.id !== id);
  writeDatabase(db);
  res.json({ success: true, message: "Đã xóa bảng điểm." });
});

// 8. Tải tệp tin
app.get('/api/download/:filename', (req, res) => {
  const { filename } = req.params;
  const downloadName = req.query.name || filename;
  const filePath = path.join(UPLOAD_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Tệp tin không tồn tại trên hệ thống.");
  }

  res.download(filePath, downloadName);
});

// 8b. Xem nội dung file trực tiếp trên Web (Xem Inline / Preview)
app.get('/api/raw-file/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(UPLOAD_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Tệp tin không tồn tại trên hệ thống.");
  }

  res.sendFile(filePath);
});

// 8c. Đọc nội dung file dạng văn bản / mã nguồn để hiển thị trực tiếp
app.get('/api/file-text/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(UPLOAD_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Tệp tin không tồn tại." });
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ success: true, content, size: fs.statSync(filePath).size });
  } catch (err) {
    res.status(500).json({ error: "Không thể đọc nội dung văn bản: " + err.message });
  }
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

// 9. API Trạng thái & Mở thư mục đám mây trên máy Mac
app.get('/api/cloud-sync-status', (req, res) => {
  const status = CLOUD_SYNC_ROOTS.map(cloud => {
    const parentDir = path.dirname(cloud.path);
    const isAvailable = fs.existsSync(parentDir);
    return {
      provider: cloud.provider,
      name: cloud.name,
      path: cloud.path,
      isAvailable
    };
  });
  res.json({ 
    cloudSyncs: status,
    googleDriveApi: {
      configured: isDriveApiConfigured()
    }
  });
});

app.post('/api/open-cloud-folder', (req, res) => {
  const { provider } = req.body; // 'gdrive' | 'onedrive'
  const { exec } = require('child_process');

  const selected = CLOUD_SYNC_ROOTS.find(c => c.provider === provider) || CLOUD_SYNC_ROOTS[0];
  const targetPath = selected.path;

  if (!fs.existsSync(targetPath)) {
    try {
      fs.mkdirSync(targetPath, { recursive: true });
    } catch (e) {}
  }

  if (fs.existsSync(targetPath)) {
    exec(`open "${targetPath}"`);
    return res.json({ success: true, message: `Đã mở thư mục ${selected.name} trên Finder máy Mac!` });
  } else {
    return res.status(404).json({ success: false, message: `Chưa tìm thấy thư mục ${selected.name} trên máy Mac.` });
  }
});

// Khởi động server (Lắng nghe trên toàn bộ địa chỉ 0.0.0.0 để máy khác trong mạng truy cập được)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 EDUCLASS SERVER ĐANG CHẠY TẠI: http://localhost:${PORT}`);
  console.log(`🌐 MẠNG NỘI BỘ (LAN/Wi-Fi): http://192.168.1.131:${PORT}`);
  console.log(`=======================================================`);
});
