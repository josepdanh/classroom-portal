/**
 * cleanup-cloudinary-expired.js
 * Tự động hóa công việc xóa file trên Cloudinary sau 60 ngày tính từ ngày kết thúc nhiệm vụ (dueDate)
 */

const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { MongoClient } = require('mongodb');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// Cấu hình Cloudflare R2
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "de3c89754598ddfb68c7b5947df665ef";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "006fbb0b78af8772fcc2d9953068aa1e";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "dc86e1ecf54214db0697fa84f88dec94d4d1e506e11c56487bbb1435f35727b9";
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "educlass-files";

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY
  }
});

async function destroyR2File(key) {
  if (!key) return { success: false, reason: 'No key' };
  try {
    await r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
    return { success: true, provider: 'r2' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Cấu hình Cloudinary
const CLOUDINARY_URL = process.env.CLOUDINARY_URL || "cloudinary://935592411136868:ZbzIp26WqTM0dlRDGbgNm2Jh9hk@riddonyi";
process.env.CLOUDINARY_URL = CLOUDINARY_URL;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'riddonyi',
  api_key: process.env.CLOUDINARY_API_KEY || '935592411136868',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'ZbzIp26WqTM0dlRDGbgNm2Jh9hk'
});

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://josepdanh_db_user:RZr9ZyW1u8Itji2H@cluster0.jdus1os.mongodb.net/educlass?retryWrites=true&w=majority";
const DATA_FILE = path.join(__dirname, 'data.json');
const BACKUP_FILE = path.join(__dirname, 'data.backup.json');

const RETENTION_DAYS = 60; // 60 ngày sau ngày kết thúc nhiệm vụ (dueDate)

function extractCloudinaryPublicId(url) {
  if (!url || typeof url !== 'string' || !url.includes('cloudinary.com')) return null;
  try {
    const match = url.match(/\/upload\/(?:v\d+\/)?(.+)$/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
  } catch (e) {}
  return null;
}

async function destroyCloudinaryFile(publicId) {
  if (!publicId) return { success: false, reason: 'No publicId' };
  try {
    let res = await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
    if (res && res.result === 'ok') return { success: true, resource_type: 'raw' };
    
    res = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
    if (res && res.result === 'ok') return { success: true, resource_type: 'image' };

    res = await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
    if (res && res.result === 'ok') return { success: true, resource_type: 'video' };

    return { success: false, result: res ? res.result : 'not_found' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function destroyCloudFile(fileObj) {
  if (!fileObj || !fileObj.url) return { success: false, reason: 'No file' };
  if (fileObj.url.includes('r2.dev') || fileObj.provider === 'r2') {
    const key = fileObj.storageKey || fileObj.url.replace(/^https:\/\/[^/]+\//, '');
    return await destroyR2File(key);
  } else {
    const publicId = fileObj.publicId || extractCloudinaryPublicId(fileObj.url);
    return await destroyCloudinaryFile(publicId);
  }
}

async function cleanupExpiredFiles() {
  console.log('===============================================================');
  console.log(`🧹 BẮT ĐẦU QUÉT FILE CLOUDINARY QUÁ HẠN ${RETENTION_DAYS} NGÀY TÍNH TỪ DUE DATE`);
  console.log(`⏰ Thời gian thực thi: ${new Date().toISOString()}`);
  console.log('===============================================================');

  let db = null;
  let mongoClient = null;
  let mongoCol = null;

  // 1. Tải dữ liệu từ MongoDB Atlas hoặc data.json
  try {
    mongoClient = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    await mongoClient.connect();
    mongoCol = mongoClient.db('educlass').collection('system_data');
    const cloudDoc = await mongoCol.findOne({ id: 'main' });
    if (cloudDoc) {
      delete cloudDoc._id;
      db = cloudDoc;
      console.log(`[Database] Đã tải CSDL từ MongoDB Atlas: ${db.assignments?.length || 0} bài tập, ${db.submissions?.length || 0} bài nộp.`);
    }
  } catch (err) {
    console.log(`[Database] Không thể kết nối MongoDB Atlas (${err.message}). Dùng file data.json cục bộ.`);
  }

  if (!db) {
    if (fs.existsSync(DATA_FILE)) {
      db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } else {
      console.error('Không tìm thấy dữ liệu để quét.');
      return { success: false, message: 'No data file found' };
    }
  }

  if (!db.assignments) db.assignments = [];
  if (!db.submissions) db.submissions = [];

  const now = new Date();
  let expiredAssignmentsCount = 0;
  let deletedFilesCount = 0;
  let freedBytesEstimate = 0;
  const deletedDetails = [];

  for (const asm of db.assignments) {
    if (!asm.dueDate) continue;

    const dueDate = new Date(asm.dueDate);
    if (isNaN(dueDate.getTime())) continue;

    const diffMs = now.getTime() - dueDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    // Kiểm tra nếu đã quá 60 ngày tính từ ngày kết thúc nhiệm vụ
    if (diffDays >= RETENTION_DAYS) {
      expiredAssignmentsCount++;
      console.log(`\n📌 Bài tập hết hạn [${asm.id}]: "${asm.title}" (Lớp: ${asm.targetClass}, Môn: ${asm.subject})`);
      console.log(`   - Hạn nộp: ${asm.dueDate} (Đã kết thúc cách đây ${diffDays} ngày >= ${RETENTION_DAYS} ngày)`);

      // 1. Xóa file đính kèm của đề bài (nếu có)
      if (asm.attachment && asm.attachment.url && !asm.attachment.cloudinaryDeleted) {
        console.log(`   - Đang xóa file đề bài đám mây: ${asm.attachment.url}...`);
        const res = await destroyCloudFile(asm.attachment);
        asm.attachment.cloudinaryDeleted = true;
        asm.attachment.deletedAt = now.toISOString();
        asm.attachment.cleanupReason = `Tự động xóa sau ${diffDays} ngày kể từ ngày kết thúc nhiệm vụ`;
        deletedFilesCount++;
        freedBytesEstimate += (asm.attachment.size || 0);
        deletedDetails.push({
          type: 'assignment_attachment',
          assignmentId: asm.id,
          title: asm.title,
          url: asm.attachment.url,
          result: res
        });
      }

      // 2. Xóa các file nộp của học sinh thuộc bài tập này
      const relatedSubmissions = db.submissions.filter(s => s.assignmentId === asm.id);
      console.log(`   - Có ${relatedSubmissions.length} lượt nộp bài cần kiểm tra file đám mây...`);

      for (const sub of relatedSubmissions) {
        const fileObj = sub.file || sub.fileData;
        if (fileObj && fileObj.url && !fileObj.cloudinaryDeleted) {
          console.log(`     + Xóa bài nộp [${sub.studentName || sub.studentId}]: ${fileObj.url}...`);
          const res = await destroyCloudFile(fileObj);
          fileObj.cloudinaryDeleted = true;
          fileObj.deletedAt = now.toISOString();
          fileObj.cleanupReason = `Tự động xóa sau ${diffDays} ngày kể từ ngày kết thúc nhiệm vụ`;
          deletedFilesCount++;
          freedBytesEstimate += (fileObj.size || 0);
          deletedDetails.push({
            type: 'submission_file',
            assignmentId: asm.id,
            submissionId: sub.id,
            studentName: sub.studentName,
            url: fileObj.url,
            result: res
          });
        }
      }
    }
  }

  // Lưu lại CSDL nếu có file được xử lý
  if (deletedFilesCount > 0) {
    db.updatedAt = now.toISOString();
    try {
      const content = JSON.stringify(db, null, 2);
      fs.writeFileSync(DATA_FILE, content, 'utf8');
      fs.writeFileSync(BACKUP_FILE, content, 'utf8');
      console.log(`[Database] Đã cập nhật file cục bộ data.json.`);
    } catch (e) {
      console.error('[Database] Lỗi ghi file:', e.message);
    }

    if (mongoCol) {
      try {
        await mongoCol.updateOne(
          { id: 'main' },
          { $set: { assignments: db.assignments, submissions: db.submissions, updatedAt: now.toISOString() } }
        );
        console.log(`[Database] Đã đồng bộ trạng thái dọn dẹp lên MongoDB Atlas.`);
      } catch (e) {
        console.error('[Database] Lỗi cập nhật MongoDB Atlas:', e.message);
      }
    }
  }

  if (mongoClient) {
    try { await mongoClient.close(); } catch (e) {}
  }

  console.log('\n===============================================================');
  console.log(`✅ HOÀN TẤT QUÉT DỌN DẸP CLOUDINARY:`);
  console.log(`   - Tổng bài tập đã quét: ${db.assignments.length}`);
  console.log(`   - Bài tập quá hạn (> 60 ngày): ${expiredAssignmentsCount}`);
  console.log(`   - Tổng số file đã xóa trên Cloudinary: ${deletedFilesCount}`);
  console.log(`   - Dung lượng ước tính giải phóng: ${(freedBytesEstimate / (1024 * 1024)).toFixed(2)} MB`);
  console.log('===============================================================');

  return {
    success: true,
    scannedAssignments: db.assignments.length,
    expiredAssignmentsCount,
    deletedFilesCount,
    freedBytesEstimate,
    deletedDetails
  };
}

// Nếu chạy trực tiếp từ Terminal hoặc GitHub Action
if (require.main === module) {
  cleanupExpiredFiles().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error('Lỗi nghiêm trọng:', err);
    process.exit(1);
  });
}

module.exports = {
  cleanupExpiredFiles,
  extractCloudinaryPublicId,
  destroyCloudinaryFile,
  RETENTION_DAYS
};
