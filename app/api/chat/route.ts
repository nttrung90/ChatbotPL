import { NextResponse } from 'next/server';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, DocumentData, Timestamp } from 'firebase-admin/firestore';
import Groq from 'groq-sdk';

// ==========================================
// 1. KHỞI TẠO VÀ ĐỊNH NGHĨA KIỂU DỮ LIỆU
// ==========================================

interface ChunkData extends DocumentData {
  file_name: string;
  content: string;
  embedding: number[];
  created_at: Timestamp;
}

interface ChatMessage {
  role: 'user' | 'assistant'; // 🔴 Đã bỏ 'system' khỏi input của Client
  content: string;
}

function getDb() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error("SERVER_CONFIG_ERROR");
    }

    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n'),
      })
    });
  }
  return getFirestore();
}

// Hàm Regex mạnh mẽ, chuẩn xác hơn
function extractLegalReferences(text: string): string[] {
  const references = new Set<string>();
  
  // Bắt: Điểm a Khoản 1 Điều 2 | Khoản 2 Điều 3 | Điều 45 | Chương II | Mục 1
  const regex = /(Điểm\s+[a-zđ]+\s+Khoản\s+\d+\s+Điều\s+\d+[a-zđ]?|Khoản\s+\d+\s+Điều\s+\d+[a-zđ]?|Điều\s+\d+[a-zđ]?|Chương\s+[IVXLCDM]+|Mục\s+\d+)/gi;
  
  let match;
  while ((match = regex.exec(text)) !== null) {
    const ref = match[0].trim();
    references.add(ref.charAt(0).toUpperCase() + ref.slice(1).toLowerCase());
  }

  return Array.from(references);
}

export async function POST(req: Request) {
  try {
    // ==========================================
    // 2. VALIDATE VÀ BẢO MẬT MESSAGES
    // ==========================================
    const body = await req.json();
    const rawMessages = body.messages;

    if (!rawMessages || !Array.isArray(rawMessages) || rawMessages.length === 0) {
      return NextResponse.json({ error: "Dữ liệu tin nhắn không hợp lệ." }, { status: 400 });
    }

    // 🔴 BẢO MẬT: Chặn Client gửi 'system' prompt
    const validRoles = ['user', 'assistant'];
    const messages: ChatMessage[] = rawMessages
      .filter((msg: any) => msg && validRoles.includes(msg.role) && typeof msg.content === 'string' && msg.content.trim() !== '')
      .map((msg: any) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content.trim()
      }));

    if (messages.length === 0) {
      return NextResponse.json({ error: "Không có tin nhắn hợp lệ để xử lý." }, { status: 400 });
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'user') {
      return NextResponse.json({ error: "Yêu cầu cuối cùng phải đến từ người dùng." }, { status: 400 });
    }

    const userMessage = lastMessage.content;

    const db = getDb();
    if (!process.env.GROQ_API_KEY || !process.env.OPENAI_API_KEY) {
      throw new Error("SERVER_CONFIG_ERROR");
    }
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    // ==========================================
    // 3. XỬ LÝ EMBEDDING VỚI OPENAI
    // ==========================================
    let userEmbedding: number[];
    
    const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: userMessage,
      })
    });

    if (!embeddingResponse.ok) {
      throw new Error(`OpenAI_API_Error: ${embeddingResponse.status}`);
    }
    
    const embeddingData = await embeddingResponse.json();
    
    if (
      !embeddingData || 
      !Array.isArray(embeddingData.data) || 
      embeddingData.data.length === 0 || 
      !Array.isArray(embeddingData.data[0].embedding)
    ) {
      throw new Error("Dữ liệu vector từ OpenAI bị sai cấu trúc hoặc rỗng.");
    }

    userEmbedding = embeddingData.data[0].embedding;

    // ==========================================
    // 4. TRUY VẤN RAG (Cú pháp Object & Lấy Distance)
    // ==========================================
    const chunksRef = db.collection('chunks');
    
    // 🟠 Cú pháp Object thuần tuý cho Firestore SDK Vector Search
    const vectorQuery = chunksRef.findNearest({
      vectorField: 'embedding',
      queryVector: FieldValue.vector(userEmbedding),
      limit: 10,
      distanceMeasure: 'COSINE',
      distanceResultField: 'distance_score' // Lấy ra điểm số khoảng cách
    });
    
    const snapshot = await vectorQuery.get();

    // ==========================================
    // 5. CHUẨN BỊ NGỮ CẢNH (Mã hóa DocID)
    // ==========================================
    let contextText = '';
    const MAX_CONTEXT_LENGTH = 15000; 
    let currentContextLength = 0;
    
    // Lưu trữ thông tin mapping: DocID -> [Tên file, Các Điều khoản]
    const sourceMap = new Map<string, { file: string, refs: Set<string> }>();
    
    let docCounter = 1;

    if (!snapshot.empty) {
      snapshot.forEach((doc) => {
        const data = doc.data() as ChunkData & { distance_score: number };
        
        // 🟠 Lọc chủ động (Dynamic Threshold)
        // Cosine distance: 0 là giống nhau hoàn toàn, gần 1 là khác nhau.
        // Bỏ qua các văn bản có khoảng cách quá lớn (không liên quan)
        if (data.distance_score !== undefined && data.distance_score > 0.45) {
          return; // Skip chunk này
        }
        
        // Tạo DocID để mã hóa (ví dụ: [Doc1])
        const docId = `[Doc${docCounter}]`;
        
        const chunkText = `<Nguon id="${docId}">\n${data.content}\n</Nguon>\n\n`;
        
        if (currentContextLength + chunkText.length <= MAX_CONTEXT_LENGTH) {
           contextText += chunkText;
           currentContextLength += chunkText.length;
           
           // Trích xuất Điều/Khoản
           const extractedRefs = extractLegalReferences(data.content);
           
           // Lưu mapping để đối chiếu sau này
           if (!sourceMap.has(docId)) {
             sourceMap.set(docId, { file: data.file_name, refs: new Set(extractedRefs) });
           } else {
             const existing = sourceMap.get(docId)!;
             extractedRefs.forEach(ref => existing.refs.add(ref));
           }
           
           docCounter++;
        }
      });
    }

    if (contextText === '') {
      contextText = "<Nguon id=\"[Rong]\">\nKHONG_CO_TAI_LIEU\n</Nguon>";
    }

    // ==========================================
    // 6. GỌI GROQ LLM (Chặn tự bịa Citation)
    // ==========================================
    // 🟠 Ép LLM chỉ được phép dùng mã [DocX] thay vì tự sinh ra tên file
    const systemPrompt = `Bạn là một chuyên gia pháp lý AI. 
Nhiệm vụ của bạn là trả lời câu hỏi dựa HOÀN TOÀN vào các tài liệu trong thẻ <Nguon> bên dưới.

QUY TẮC SỐNG CÒN:
1. KHÔNG BỊA ĐẶT: Nếu nội dung trong <Nguon> là "KHONG_CO_TAI_LIEU" hoặc không đủ để trả lời, BẮT BUỘC nói: "Không đủ thông tin để kết luận." Tuyệt đối không tự suy diễn.
2. ÉP TRÍCH DẪN MÃ NGUỒN: Khi sử dụng thông tin từ bất kỳ đoạn nào, BẮT BUỘC chèn mã id của nguồn đó ngay sau câu văn. 
   - Ví dụ đúng: Người lao động có quyền nghỉ phép năm [Doc1].
   - Ví dụ sai: Người lao động có quyền nghỉ phép năm theo Luật Lao động.
   - TUYỆT ĐỐI KHÔNG tự bịa ra tên luật, tên file hay bất kỳ tài liệu nào khác ngoài mã [DocX] được cung cấp.

NGỮ CẢNH:
${contextText}`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      model: 'llama3-70b-8192', 
      temperature: 0.05, // Giảm sâu hơn nữa để loại bỏ hallucination
      stream: false, 
    });

    const aiResponse = completion.choices[0]?.message?.content || "Lỗi xử lý phản hồi từ AI.";

    // ==========================================
    // 7. XỬ LÝ CITATION & TRẢ KẾT QUẢ CHO CLIENT
    // ==========================================
    
    // Lọc lại những Citation (DocID) mà LLM THỰC SỰ SỬ DỤNG trong câu trả lời
    const finalCitations = new Set<string>();
    
    sourceMap.forEach((info, docId) => {
      // Nếu AI có nhắc đến [Doc1] trong câu trả lời
      if (aiResponse.includes(docId)) {
        if (info.refs.size > 0) {
          finalCitations.add(`${info.file} (${Array.from(info.refs).join(', ')})`);
        } else {
          finalCitations.add(info.file);
        }
      }
    });

    return NextResponse.json({
      role: 'assistant',
      content: aiResponse,
      citations: Array.from(finalCitations) 
    });

  } catch (error: unknown) { 
    let errorMessage = "Đã xảy ra lỗi không xác định. Vui lòng thử lại sau.";
    
    if (error instanceof Error) {
      console.error("[API_CHAT_ERROR]:", error.message);
      if (error.message === "SERVER_CONFIG_ERROR") {
        errorMessage = "Lỗi cấu hình hệ thống máy chủ.";
      }
    } else {
      console.error("[API_CHAT_ERROR]:", error);
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
