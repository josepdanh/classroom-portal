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

  const newUser = {
    id: `u_${role}_${Date.now()}`,
    username: username.trim(),
    password: password.trim(),
    name: name.trim(),
    role: role,
    className: role === 'student' ? (className ? className.trim() : '11A1') : undefined,
    subject: role === 'teacher' ? (subject ? subject.trim() : 'Tin học') : undefined
  };

  db.users.push(newUser);
  writeDatabase(db);

  const { password: _, ...userInfo } = newUser;
  return res.json({ success: true, message: "Đăng ký tài khoản thành công!", user: userInfo });
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

app.post('/api/classes', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ message: "Vui lòng nhập tên lớp học." });
  }
  const cleanName = name.trim().toUpperCase();
  const db = readDatabase();
  if (!db.classes) db.classes = [];
  if (!db.classes.map(c => c.toUpperCase()).includes(cleanName)) {
    db.classes.push(cleanName);
    writeDatabase(db);
  }
  res.json({ success: true, message: `Đã tạo lớp ${cleanName} thành công!`, className: cleanName });
});

// 2. Lấy danh sách bài tập (Phân tách độc lập theo từng lớp học)
app.get('/api/assignments', (req, res) => {
  const { studentId, teacherFilterClass } = req.query;
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
  } else if (teacherFilterClass && teacherFilterClass !== 'ALL') {
    // GIÁO VIÊN: Lọc theo lớp được chọn
    const filterClass = teacherFilterClass.trim().toUpperCase();
    targetAssignments = db.assignments.filter(asm => {
      return asm.targetClass && asm.targetClass.trim().toUpperCase() === filterClass;
    });
  }

  const result = targetAssignments.map(asm => {
    const submissions = db.submissions.filter(s => s.assignmentId === asm.id);
    const submittedCount = submissions.length;
    const gradedCount = submissions.filter(s => s.grade !== null && s.grade !== undefined).length;

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

// 3. Giáo viên tạo bài tập mới (Chỉ định rõ lớp học nhận bài)
app.post('/api/assignments', upload.single('attachment'), (req, res) => {
  const { title, description, dueDate, teacherId, targetClass } = req.body;

  if (!title || !description || !dueDate) {
    return res.status(400).json({ message: "Vui lòng điền đầy đủ tiêu đề, yêu cầu và hạn nộp." });
  }

  const db = readDatabase();
  const cleanTargetClass = targetClass && targetClass.trim() ? targetClass.trim().toUpperCase() : 'ALL';

  // Tự động ghi nhớ lớp mới nếu chưa có
  if (cleanTargetClass !== 'ALL') {
    if (!db.classes) db.classes = [];
    if (!db.classes.map(c => c.toUpperCase()).includes(cleanTargetClass)) {
      db.classes.push(cleanTargetClass);
    }
  }

  const newAssignment = {
    id: `asm_${Date.now()}`,
    title: title.trim(),
    description: description.trim(),
    targetClass: cleanTargetClass,
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

// 4. Giáo viên xóa bài tập
app.delete('/api/assignments/:id', (req, res) => {
  const { id } = req.params;
  const db = readDatabase();

  const initialLength = db.assignments.length;
  db.assignments = db.assignments.filter(a => a.id !== id);
  db.submissions = db.submissions.filter(s => s.assignmentId !== id);

  if (db.assignments.length === initialLength) {
    return res.status(404).json({ message: "Không tìm thấy bài tập cần xóa." });
  }

  writeDatabase(db);
  res.json({ success: true, message: "Đã xóa bài tập thành công." });
});

// 5. Giáo viên xem danh sách học sinh nộp bài (Chỉ hiện học sinh thuộc lớp nhận bài)
app.get('/api/assignments/:id/submissions', (req, res) => {
  const { id } = req.params;
  const db = readDatabase();

  const assignment = db.assignments.find(a => a.id === id);
  if (!assignment) {
    return res.status(404).json({ message: "Không tìm thấy bài tập." });
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

// 7. Giáo viên chấm điểm
app.post('/api/submissions/:id/grade', (req, res) => {
  const { id } = req.params;
  const { grade, feedback } = req.body;

  const numGrade = parseFloat(grade);
  if (isNaN(numGrade) || numGrade < 0 || numGrade > 10) {
    return res.status(400).json({ message: "Điểm số phải là số thực từ 0.0 đến 10.0." });
  }

  const db = readDatabase();
  const sub = db.submissions.find(s => s.id === id);

  if (!sub) {
    return res.status(404).json({ message: "Không tìm thấy bài nộp." });
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
