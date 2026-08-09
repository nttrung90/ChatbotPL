require('dotenv').config({ path: '.env.local' });
const { google } = require('googleapis');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const tesseract = require('tesseract.js');

// Khởi tạo Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    })
  });
}
const db = admin.firestore();

// Khởi tạo Google Drive API
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_DRIVE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
const drive = google.drive({ version: 'v3', auth });

// Hàm gọi API tạo Embedding của Gemini
async function getEmbedding(text) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'models/text-embedding-004',
      content: {
        parts: [{ text: text }]
      }
    })
  });
  const data = await response.json();
  return data.embedding.values;
}

// Hàm chia nhỏ văn bản (Chunking)
function chunkText(text, maxChars = 1000) {
  const chunks = [];
  let currentChunk = '';
  const sentences = text.split(/(?<=[.?!])\s+/); 

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxChars) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += ' ' + sentence;
    }
  }
  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
}

// Hàm chính xử lý Google Drive
async function processDriveFolder(folderId) {
  try {
    console.log(`Đang lấy danh sách file từ thư mục ${folderId}...`);
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType)',
    });

    const files = res.data.files;
    if (!files || files.length === 0) {
      console.log('Không tìm thấy file nào.');
      return;
    }

    for (const file of files) {
      console.log(`\nĐang xử lý file: ${file.name} (${file.mimeType})`);
      let extractedText = '';

      const response = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data);

      try {
        if (file.mimeType === 'application/pdf') {
          const pdfData = await pdfParse(buffer);
          extractedText = pdfData.text;
        } 
        else if (file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          const docxData = await mammoth.extractRawText({ buffer: buffer });
          extractedText = docxData.value;
        } 
        else if (file.mimeType.startsWith('image/')) {
          console.log('Đang chạy OCR...');
          const { data: { text } } = await tesseract.recognize(buffer, 'vie');
          extractedText = text;
        } 
        else {
          console.log('Định dạng không được hỗ trợ, bỏ qua.');
          continue;
        }
      } catch (parseError) {
        console.error(`Lỗi đọc file ${file.name}:`, parseError.message);
        continue;
      }

      extractedText = extractedText.replace(/\s+/g, ' ').trim();
      if (!extractedText) {
        console.log('Không trích xuất được text, bỏ qua.');
        continue;
      }

      // Lưu Metadata vào bảng documents trong Firestore
      const docRef = db.collection('documents').doc();
      await docRef.set({
        file_name: file.name,
        file_type: file.mimeType,
        created_at: admin.firestore.FieldValue.serverTimestamp()
      });

      const chunks = chunkText(extractedText);
      console.log(`Đã chia thành ${chunks.length} chunks. Đang tạo vector bằng Gemini và lưu vào Firestore...`);

      let batch = db.batch();
      let batchCount = 0;

      for (const [index, chunk] of chunks.entries()) {
        const embedding = await getEmbedding(chunk);
        
        const chunkRef = db.collection('chunks').doc();
        batch.set(chunkRef, {
          document_id: docRef.id,
          file_name: file.name, 
          content: chunk,
          embedding: FieldValue.vector(embedding), 
          created_at: admin.firestore.FieldValue.serverTimestamp()
        });

        batchCount++;
        
        if (batchCount === 450 || index === chunks.length - 1) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
      console.log(`Hoàn tất file: ${file.name}`);
    }
    
    console.log('\nQUÁ TRÌNH DOCUMENT WORKER HOÀN TẤT.');
  } catch (error) {
    console.error('Lỗi quá trình Worker:', error);
  }
}

// Thay thế ID thư mục Google Drive
const TARGET_FOLDER_ID = 'NHAP_ID_THU_MUC_CUA_BAN_VAO_DAY'; 
processDriveFolder(TARGET_FOLDER_ID);
