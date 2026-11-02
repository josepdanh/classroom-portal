const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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
app.use(express.static(path.join(__dirname, 'public')));

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
    return JSON.parse(raw);
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

// ================= API ENDPOINTS =================

// 1. Đăng nhập (Không phân biệt chữ hoa, chữ thường cho tên tài khoản)
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: "Vui lòng nhập đầy đủ tài khoản và mật khẩu." });
  }

  const db = readDatabase();
  const inputUsername = username.trim().toLowerCase();
  const inputPassword = password.trim();

  // So sánh username không phân biệt hoa thường
  const user = db.users.find(u => 
    u.username.trim().toLowerCase() === inputUsername && u.password.trim() === inputPassword
  );

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

// 1b. Đăng ký tài khoản mới (Giáo viên hoặc Học sinh)
app.post('/api/auth/register', (req, res) => {
  const { username, password, name, role, className, subject } = req.body;
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

  const newUser = {
    id: `u_${role}_${Date.now()}`,
    username: username.trim(),
    password: password.trim(),
    name: name.trim(),
    role: role,
    className: role === 'student' ? (className ? className.trim().toUpperCase() : 'C08TK') : undefined,
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

app.post('/api/subjects', (req, res) => {
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
  target.className = className ? className.trim().toUpperCase() : 'C08TK';
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

  db.assignments.unshift(newAssignment);
  writeDatabase(db);

  res.json({ success: true, message: `Giao bài tập mới cho lớp ${cleanTargetClass} thành công!`, assignment: newAssignment });
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

// Khởi động server (Lắng nghe trên toàn bộ địa chỉ 0.0.0.0 để máy khác trong mạng truy cập được)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 EDUCLASS SERVER ĐANG CHẠY TẠI: http://localhost:${PORT}`);
  console.log(`🌐 MẠNG NỘI BỘ (LAN/Wi-Fi): http://192.168.1.131:${PORT}`);
  console.log(`=======================================================`);
});
