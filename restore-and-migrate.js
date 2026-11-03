const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const MONGODB_URI = "mongodb+srv://josepdanh_db_user:RZr9ZyW1u8Itji2H@cluster0.jdus1os.mongodb.net/educlass?retryWrites=true&w=majority";
const DATA_FILE = path.join(__dirname, 'data.json');
const BACKUP_FILE = path.join(__dirname, 'data.backup.json');

// Danh sách sinh viên lớp T14TK01 trích xuất từ sổ điểm
const T14TK01_STUDENTS = [
  { code: 'T14TK0101', name: 'Lê Thị Vân Anh', dob: '15/04/2006' },
  { code: 'T14TK0102', name: 'Vũ Hoàng Minh Anh', dob: '16/12/2006' },
  { code: 'T14TK0103', name: 'Nguyễn Hoàng Gia Ân', dob: '21/10/2006' },
  { code: 'T14TK0104', name: 'Trần Thụ Ân', dob: '10/08/2006' },
  { code: 'T14TK0105', name: 'Phạm Gia Bảo', dob: '10/11/2006' },
  { code: 'T14TK0106', name: 'Hoàng Nguyễn Bảo Châu', dob: '22/04/2006' },
  { code: 'T14TK0107', name: 'Nguyễn Thành Đạt', dob: '23/04/2003' },
  { code: 'T14TK0109', name: 'Vũ Ngọc Thanh Hằng', dob: '30/01/2006' },
  { code: 'T14TK0110', name: 'Bùi Thanh Hiền', dob: '26/09/2006' },
  { code: 'T14TK0111', name: 'Nguyễn Đăng Vinh Hiển', dob: '03/03/2006' },
  { code: 'T14TK0112', name: 'Mai Nhật Hoàng', dob: '10/10/2006' },
  { code: 'T14TK0113', name: 'Nguyễn Đăng Khoa', dob: '26/11/2006' },
  { code: 'T14TK0114', name: 'Võ Tuấn Khang', dob: '03/11/2006' },
  { code: 'T14TK0115', name: 'Nguyễn Hoàng Kiệt', dob: '27/09/2006' },
  { code: 'T14TK0116', name: 'Nguyễn Xuân Hoàng Kim', dob: '03/12/2006' },
  { code: 'T14TK0117', name: 'Ngô Trúc Linh', dob: '13/10/2006' },
  { code: 'T14TK0118', name: 'Nguyễn Nhật Linh', dob: '06/10/2006' },
  { code: 'T14TK0119', name: 'Đặng Quang Minh', dob: '24/05/2006' },
  { code: 'T14TK0120', name: 'Đặng Thụy My', dob: '18/02/2006' },
  { code: 'T14TK0121', name: 'Võ Trần Thúy Ngân', dob: '16/09/2006' },
  { code: 'T14TK0122', name: 'Đoàn Kim Ngọc', dob: '05/05/2006' },
  { code: 'T14TK0123', name: 'Phạm Thị Hương Ngọc', dob: '01/09/2006' },
  { code: 'T14TK0124', name: 'Đào Minh Nhật', dob: '08/09/2006' },
  { code: 'T14TK0125', name: 'Nguyễn Thị Quỳnh Nhi', dob: '18/03/2006' },
  { code: 'T14TK0126', name: 'Trịnh Minh Phi', dob: '12/10/2006' },
  { code: 'T14TK0127', name: 'Nguyễn Hoàng Thảo Quyên', dob: '28/10/2006' },
  { code: 'T14TK0129', name: 'Nguyễn Anh Thi', dob: '24/06/2006' },
  { code: 'T14TK0130', name: 'Trương Nguyễn Bảo Trân', dob: '14/10/2006' },
  { code: 'T14TK0131', name: 'Nguyễn Ngọc Tường Vy', dob: '04/04/2005' },
  { code: 'T14TK0132', name: 'Trần Lê Thanh Vy', dob: '27/10/2006' }
];

async function run() {
  console.log('🔄 Đang đọc CSDL hiện tại...');
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const db = JSON.parse(raw);

  if (!db.users) db.users = [];
  if (!db.assignments) db.assignments = [];
  if (!db.submissions) db.submissions = [];
  if (!db.classes) db.classes = [];
  if (!db.subjects) db.subjects = [];

  // 1. Đảm bảo lớp T14TK01 có trong db.classes
  if (!db.classes.includes('T14TK01')) {
    db.classes.push('T14TK01');
  }

  // 2. Nạp toàn bộ sinh viên lớp T14TK01 vào db.users
  T14TK01_STUDENTS.forEach(s => {
    let user = db.users.find(u => (u.studentCode && u.studentCode.toUpperCase() === s.code) || (u.username && u.username.toUpperCase() === s.code));
    if (!user) {
      user = {
        id: `u_${s.code}`,
        username: s.code,
        studentCode: s.code,
        password: '123',
        name: s.name,
        dob: s.dob,
        role: 'student',
        className: 'T14TK01',
        status: 'ACTIVE',
        createdAt: '2026-11-03T03:40:00.000Z'
      };
      db.users.push(user);
    } else {
      user.className = 'T14TK01';
      user.studentCode = s.code;
      user.name = s.name;
    }
  });

  // Hỗ trợ thêm alias ID cho Đặng Thụy My nếu trước đó dùng u_student_T14TK0120
  const myUser = db.users.find(u => u.studentCode === 'T14TK0120');
  if (myUser) {
    myUser.id = 'u_student_T14TK0120';
  }

  // 3. Khôi phục bài tập "Thiết kế Catalog 16 trang về chủ đề bất kỳ"
  const asmId = 'asm_1793677200000';
  let targetAsm = db.assignments.find(a => a.id === asmId || a.title.includes('16 trang'));
  if (!targetAsm) {
    targetAsm = {
      id: asmId,
      title: 'Thiết kế Catalog 16 trang về chủ đề bất kỳ',
      description: 'Thiết kế Catalog 16 trang về chủ đề bất kỳ theo chuẩn in ấn',
      targetClass: 'T14TK01',
      subject: 'Thiết Kế Catalog',
      dueDate: '2026-11-10T16:42',
      createdAt: '2026-11-03T03:40:00.000Z',
      attachment: null,
      createdBy: 'u_teacher_danh',
      teacherName: 'Thầy Nguyễn Công Danh',
      teacherSubject: 'Tin học'
    };
    db.assignments.push(targetAsm);
  }

  // 4. Khôi phục 5 bài nộp của 5 bạn
  const submissionsToRestore = [
    {
      studentCode: 'T14TK0120',
      studentName: 'Đặng Thụy My',
      content: '',
      link: '',
      file: {
        filename: 'catalog.indd',
        originalName: 'catalog.indd',
        size: 7421952
      }
    },
    {
      studentCode: 'T14TK0114',
      studentName: 'Võ Tuấn Khang',
      content: '',
      link: '',
      file: {
        filename: '1793677316388_bai_catalog_gom_vs1.indd',
        originalName: 'bài catalog gom vs1.indd',
        size: 7421952
      }
    },
    {
      studentCode: 'T14TK0104',
      studentName: 'Trần Thụ Ân',
      content: 'T14TK0104',
      link: '',
      file: {
        filename: 'T14TK0104.rar',
        originalName: 'T14TK0104.rar',
        size: 1024000
      }
    },
    {
      studentCode: 'T14TK0130',
      studentName: 'Trương Nguyễn Bảo Trân',
      content: '',
      link: '',
      file: {
        filename: 'T14TK0130-TRAN.rar',
        originalName: 'T14TK0130-TRAN.rar',
        size: 1024000
      }
    },
    {
      studentCode: 'T14TK0126',
      studentName: 'Trịnh Minh Phi',
      content: '',
      link: '',
      file: {
        filename: 'T14TK0126.indd',
        originalName: 'T14TK0126.indd',
        size: 7421952
      }
    }
  ];

  submissionsToRestore.forEach((item, idx) => {
    const student = db.users.find(u => u.studentCode === item.studentCode);
    const studentId = student ? student.id : `u_${item.studentCode}`;
    const existingIndex = db.submissions.findIndex(s => s.assignmentId === targetAsm.id && (s.studentId === studentId || s.studentName === item.studentName));
    
    const subObj = {
      id: `sub_restored_${Date.now()}_${idx}`,
      assignmentId: targetAsm.id,
      studentId: studentId,
      studentName: item.studentName,
      content: item.content,
      link: item.link,
      file: item.file,
      submittedAt: '2026-11-03T03:45:00.000Z',
      grade: null,
      feedback: null
    };

    if (existingIndex >= 0) {
      db.submissions[existingIndex] = { ...db.submissions[existingIndex], ...subObj };
    } else {
      db.submissions.push(subObj);
    }
  });

  // Lưu bản local an toàn
  const content = JSON.stringify(db, null, 2);
  fs.writeFileSync(DATA_FILE, content, 'utf8');
  fs.writeFileSync(BACKUP_FILE, content, 'utf8');
  console.log('✅ Đã khôi phục dữ liệu vào data.json và data.backup.json');

  // 5. Kết nối và ghi trực tiếp lên MONGODB ATLAS CLOUD!
  console.log('☁️ Đang kết nối tới MongoDB Atlas Cloud...');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  console.log('✅ Kết nối MongoDB Atlas thành công!');

  const database = client.db('educlass');
  const collection = database.collection('system_data');

  await collection.updateOne(
    { id: 'main' },
    { $set: { id: 'main', ...db, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );

  console.log('🎉 ĐÃ ĐỒNG BỘ DỮ LIỆU ĐẦY ĐỦ LÊN MONGODB ATLAS CLOUD THÀNH CÔNG RỰC RỠ!');
  await client.close();
}

run().catch(console.error);
