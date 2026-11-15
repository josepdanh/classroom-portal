const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://josepdanh_db_user:RZr9ZyW1u8Itji2H@cluster0.jdus1os.mongodb.net/educlass?retryWrites=true&w=majority";
const DATA_FILE = path.join(__dirname, 'data.json');
const BACKUP_FILE = path.join(__dirname, 'data.backup.json');

const rawStudents = [
  { code: '26710966', hoLot: 'Lưu Gia', ten: 'Bảo', lopGoc: '26DCT' },
  { code: '26710921', hoLot: 'Phạm Gia', ten: 'Bảo', lopGoc: '26DCT' },
  { code: '26710928', hoLot: 'Thân Quân', ten: 'Bảo', lopGoc: '26DCT' },
  { code: '26710671', hoLot: 'Trần Phan Gia', ten: 'Bảo', lopGoc: '26DCT' },
  { code: '26711146', hoLot: 'Trần Quốc', ten: 'Bảo', lopGoc: '26DCT' },
  { code: '26710395', hoLot: 'Phạm Ngọc', ten: 'Châu', lopGoc: '26DCT' },
  { code: '26710782', hoLot: 'Phạm Văn', ten: 'Chương', lopGoc: '26DCT' },
  { code: '26710399', hoLot: 'Lê Văn Thành', ten: 'Công', lopGoc: '26DCT' },
  { code: '26711066', hoLot: 'Phạm Quốc', ten: 'Cường', lopGoc: '26DCT' },
  { code: '26711141', hoLot: 'Bùi Anh', ten: 'Đại', lopGoc: '26DCT' },
  { code: '26710735', hoLot: 'Bùi Mai Hoàng', ten: 'Đại', lopGoc: '26DCT' },
  { code: '26710231', hoLot: 'Lê Trọng', ten: 'Đại', lopGoc: '26DCT' },
  { code: '26710213', hoLot: 'Nguyễn Tiến', ten: 'Đại', lopGoc: '26DCT' },
  { code: '26710974', hoLot: 'Nguyễn Xuân', ten: 'Đăng', lopGoc: '26DCT' },
  { code: '26710112', hoLot: 'Ninh Trường', ten: 'Đăng', lopGoc: '26DCT' },
  { code: '26711173', hoLot: 'Đỗ Thành', ten: 'Đạt', lopGoc: '26DCT' },
  { code: '26710918', hoLot: 'Hoàng Tiến', ten: 'Đạt', lopGoc: '26DCT' },
  { code: '26710886', hoLot: 'Hoàng Sĩ', ten: 'Đoan', lopGoc: '26DCT' },
  { code: '26710916', hoLot: 'Vũ Đình Bảo', ten: 'Đông', lopGoc: '26DCT' },
  { code: '26710592', hoLot: 'Triệu Quốc', ten: 'Đồng', lopGoc: '26DCT' },
  { code: '26710273', hoLot: 'Bùi Việt', ten: 'Đức', lopGoc: '26DCT' },
  { code: '26710137', hoLot: 'Hoàng Minh', ten: 'Đức', lopGoc: '26DCT' },
  { code: '26710471', hoLot: 'Khúc Minh', ten: 'Đức', lopGoc: '26DCT' },
  { code: '26DH1514', hoLot: 'Văn Đức Tuấn', ten: 'Duy', lopGoc: '26DCT' },
  { code: '26711212', hoLot: 'Nguyễn', ten: 'Khang', lopGoc: '26DCT' },
  { code: '26711249', hoLot: 'Nguyễn Duy Anh', ten: 'Khoa', lopGoc: '26DCT' },
  { code: '26711169', hoLot: 'Lê Ngọc', ten: 'Long', lopGoc: '26DCT' },
  { code: '26710894', hoLot: 'Phan Nguyễn Anh', ten: 'Quốc', lopGoc: '26DCT' },
  { code: '26DH1515', hoLot: 'Bùi Đức', ten: 'Sơn', lopGoc: '26DCT' },
  { code: '26710120', hoLot: 'Nguyễn Anh', ten: 'Tài', lopGoc: '26DCT' },
  { code: '26711064', hoLot: 'Phạm Ngọc', ten: 'Tài', lopGoc: '26DCT' },
  { code: '26711040', hoLot: 'Nguyễn Phạm Thiện', ten: 'Tâm', lopGoc: '26DCT' },
  { code: '26710698', hoLot: 'Trịnh Quang', ten: 'Thắng', lopGoc: '26DCT' },
  { code: '26710226', hoLot: 'Ngô Văn', ten: 'Thao', lopGoc: '26DCT' },
  { code: '26710992', hoLot: 'Võ Nguyễn Quốc', ten: 'Thịnh', lopGoc: '26DCT' },
  { code: '26710025', hoLot: 'Nguyễn Bình', ten: 'Thuận', lopGoc: '26DCT' },
  { code: '26710957', hoLot: 'Trịnh Thúc Hoàng', ten: 'Tiến', lopGoc: '26DCT' },
  { code: '26DH1508', hoLot: 'Nguyễn Minh', ten: 'Triết', lopGoc: '26DCT' },
  { code: '26711195', hoLot: 'Tạ Danh', ten: 'Trọng', lopGoc: '26DCT' },
  { code: '26711203', hoLot: 'Bùi Công', ten: 'Trường', lopGoc: '26DCT' },
  { code: '26711179', hoLot: 'Đinh Gia', ten: 'Trường', lopGoc: '26DCT' },
  { code: '26710447', hoLot: 'Nguyễn Huỳnh Quốc', ten: 'Trường', lopGoc: '26DCT' },
  { code: '26711088', hoLot: 'Nguyễn Quốc', ten: 'Tú', lopGoc: '26DCT' },
  { code: '26710927', hoLot: 'Phan Thanh', ten: 'Tùng', lopGoc: '26DCT' },
  { code: '26711127', hoLot: 'Quách Lưu Quốc', ten: 'Việt', lopGoc: '26DCT' },
  { code: '26711240', hoLot: 'Thân Thế', ten: 'Vinh', lopGoc: '26DCT' },
  { code: '26710686', hoLot: 'Nguyễn Hải Thiện', ten: 'Ý', lopGoc: '26DCT' }
];

async function run() {
  console.log(`Bắt đầu kết nối MongoDB Atlas để tạo lớp "TIN HỌC ĐẠI CƯƠNG 2" và nạp ${rawStudents.length} học sinh...`);
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const coll = client.db('educlass').collection('system_data');

  let doc = await coll.findOne({ id: 'main' });
  if (!doc) {
    console.log('Chưa có doc main, đọc từ data.json');
    doc = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  }

  const className = 'TIN HỌC ĐẠI CƯƠNG 2';

  // 1. Cập nhật mảng classes
  if (!doc.classes) doc.classes = [];
  if (!doc.classes.includes(className)) {
    doc.classes.push(className);
    doc.classes.sort();
    console.log(`✅ Đã thêm lớp "${className}" vào danh mục lớp học.`);
  }

  // 2. Cập nhật industryGroups: Khoa Công Nghệ Thông Tin
  if (!doc.industryGroups) doc.industryGroups = [];
  let cnttGroup = doc.industryGroups.find(g => 
    (g.id === 'cong_nghe_thong_tin') || 
    (g.name && g.name.toLowerCase().includes('công nghệ thông tin'))
  );

  if (cnttGroup) {
    if (!cnttGroup.classes) cnttGroup.classes = [];
    if (!cnttGroup.classes.includes(className)) {
      cnttGroup.classes.push(className);
      cnttGroup.classes.sort();
      console.log(`✅ Đã gán lớp "${className}" vào "${cnttGroup.name}".`);
    }
  } else {
    console.warn('⚠️ Không tìm thấy nhóm ngành CNTT, tạo mới');
    cnttGroup = {
      id: 'cong_nghe_thong_tin',
      name: 'Ngành Công Nghệ Thông Tin',
      classes: [className]
    };
    doc.industryGroups.push(cnttGroup);
  }

  // 3. Tạo Môn học cho lớp TIN HỌC ĐẠI CƯƠNG 2
  if (!doc.subjects) doc.subjects = [];
  const existingSubj = doc.subjects.find(s => 
    s.className === className && 
    (s.name.toLowerCase().includes('tin học đại cương'))
  );
  if (!existingSubj) {
    const newSubj = {
      id: `subj_${Date.now()}`,
      name: 'Tin Học Đại Cương 2',
      className: className,
      teacherId: 'u_teacher_danh',
      teacherName: 'Thầy Nguyễn Công Danh',
      teacherEmail: 'josepdanh@gmail.com',
      isCompleted: false,
      createdAt: new Date().toISOString()
    };
    doc.subjects.push(newSubj);
    console.log(`✅ Đã tạo môn học "${newSubj.name}" cho lớp "${className}".`);
  }

  // 4. Thêm 47 học sinh vào users
  if (!doc.users) doc.users = [];
  let addedCount = 0;
  let updatedCount = 0;

  for (const s of rawStudents) {
    const studentCode = s.code.trim();
    const fullName = `${s.hoLot.trim()} ${s.ten.trim()}`;
    const userId = `u_${studentCode}`;

    const existingUserIndex = doc.users.findIndex(u => 
      u.id === userId || 
      u.studentCode === studentCode || 
      (u.username && u.username.toUpperCase() === studentCode.toUpperCase())
    );

    if (existingUserIndex >= 0) {
      // Cập nhật lớp học cho sinh viên nếu đã tồn tại
      doc.users[existingUserIndex].name = fullName;
      doc.users[existingUserIndex].className = className;
      doc.users[existingUserIndex].originalClass = s.lopGoc;
      doc.users[existingUserIndex].status = 'ACTIVE';
      updatedCount++;
    } else {
      const newUser = {
        id: userId,
        username: studentCode,
        studentCode: studentCode,
        password: '123',
        name: fullName,
        dob: '',
        role: 'student',
        className: className,
        originalClass: s.lopGoc,
        status: 'ACTIVE',
        createdAt: new Date().toISOString()
      };
      doc.users.push(newUser);
      addedCount++;
    }
  }

  console.log(`✅ Đã nạp sinh viên: Thêm mới ${addedCount} học sinh, cập nhật ${updatedCount} học sinh. Tổng cộng: ${rawStudents.length} học sinh.`);

  // 5. Ghi vào MongoDB Atlas
  const { _id, ...cleanData } = doc;
  await coll.updateOne(
    { id: 'main' },
    { $set: { id: 'main', ...cleanData, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  console.log('✅ Đã đồng bộ thành công lên MongoDB Atlas (document "main")!');

  // 6. Ghi vào file cục bộ
  fs.writeFileSync(DATA_FILE, JSON.stringify(cleanData, null, 2), 'utf8');
  fs.writeFileSync(BACKUP_FILE, JSON.stringify(cleanData, null, 2), 'utf8');
  console.log('✅ Đã lưu vào data.json và data.backup.json cục bộ.');

  await client.close();
  console.log('🎉 HOÀN TẤT 100%!');
}

run().catch(err => {
  console.error('❌ Lỗi:', err);
  process.exit(1);
});
