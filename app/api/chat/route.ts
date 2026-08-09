import { NextResponse } from 'next/server';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, DocumentData, Timestamp } from 'firebase-admin/firestore';
import { GoogleGenerativeAI } from '@google/generative-ai';
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
  role: 'user' | 'assistant';
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

function extractLegalReferences(text: string): string[] {
  const references = new Set<string>();
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
    if (!process.env.GROQ_API_KEY || !process.env.GEMINI_API_KEY) {
      throw new Error("SERVER_CONFIG_ERROR");
    }
    
    // Khởi tạo SDK
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // ==========================================
    // 3. XỬ LÝ EMBEDDING VỚI GEMINI SDK
    // ==========================================
    let userEmbedding: number[];
    try {
      const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
      const result = await embeddingModel.embedContent(userMessage);
      
      if (!result || !result.embedding || !Array.isArray(result.embedding.values)) {
        throw new Error("Dữ liệu vector rỗng.");
      }
      userEmbedding = result.embedding.values;
    } catch (embeddingError: any) {
      console.error("Gemini SDK Error:", embeddingError);
      throw new Error(`Lỗi tạo vector: ${embeddingError.message}`);
    }

    // ==========================================
    // 4. TRUY VẤN RAG BẰNG FIRESTORE FINDNEAREST
    // ==========================================
    const chunksRef = db.collection('chunks');
    const vectorQuery = chunksRef.findNearest({
      vectorField: 'embedding',
      queryVector: FieldValue.vector(userEmbedding),
      limit: 10,
      distanceMeasure: 'COSINE',
      distanceResultField: 'distance_score' 
    });
    
    const snapshot = await vectorQuery.get();

    // ==========================================
    // 5. CHUẨN BỊ NGỮ CẢNH (Mã hóa DocID)
    // ==========================================
    let contextText = '';
    const MAX_CONTEXT_LENGTH = 15000; 
    let currentContextLength = 0;
    
    const sourceMap = new Map<string, { file: string, refs: Set<string> }>();
    let docCounter = 1;

    if (!snapshot.empty) {
      snapshot.forEach((doc) => {
        const data = doc.data() as ChunkData & { distance_score: number };
        
        if (data.distance_score !== undefined && data.distance_score > 0.45) return; 
        
        const docId = `[Doc${docCounter}]`;
        const chunkText = `<Nguon id="${docId}">\n${data.content}\n</Nguon>\n\n`;
        
        if (currentContextLength + chunkText.length <= MAX_CONTEXT_LENGTH) {
           contextText += chunkText;
           currentContextLength += chunkText.length;
           
           const extractedRefs = extractLegalReferences(data.content);
           
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
      temperature: 0.05, 
      stream: false, 
    });

    const aiResponse = completion.choices[0]?.message?.content || "Lỗi xử lý phản hồi từ AI.";

    // ==========================================
    // 7. XỬ LÝ CITATION & TRẢ KẾT QUẢ CHO CLIENT
    // ==========================================
    const finalCitations = new Set<string>();
    
    sourceMap.forEach((info, docId) => {
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
        errorMessage = "Lỗi cấu hình hệ thống máy chủ (Thiếu API Key).";
      } else if (error.message.includes("Lỗi tạo vector")) {
        errorMessage = error.message;
      }
    } else {
      console.error("[API_CHAT_ERROR]:", error);
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
