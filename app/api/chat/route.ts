import { NextResponse } from 'next/server';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import Groq from 'groq-sdk';

// Khởi tạo Firebase Admin an toàn cho Next.js (Singleton Pattern)
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Xử lý ký tự xuống dòng trong private key
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    })
  });
}
const db = getFirestore();

// Khởi tạo Groq
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();
    const userMessage = messages[messages.length - 1].content;

    // 1. Tạo Embedding cho câu hỏi của user bằng OpenAI
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
    
    const embeddingData = await embeddingResponse.json();
    const userEmbedding = embeddingData.data[0].embedding;

    // 2. Tìm kiếm Vector trong Firestore (RAG Search)
    const chunksRef = db.collection('chunks');
    const vectorQuery = chunksRef.findNearest(
      'embedding',
      FieldValue.vector(userEmbedding),
      {
        limit: 5,
        distanceMeasure: 'COSINE'
      }
    );
    
    const snapshot = await vectorQuery.get();

    // 3. Chuẩn bị ngữ cảnh và trích dẫn (Citations)
    let contextText = '';
    let citations: string[] = [];

    if (!snapshot.empty) {
      // Khai báo kiểu (doc: any) để sửa lỗi Implicit 'any' type của TypeScript
      snapshot.forEach((doc: any) => {
        const data = doc.data();
        citations.push(data.file_name);
        contextText += `Tài liệu: ${data.file_name}\nNội dung: ${data.content}\n\n`;
      });
    } else {
      contextText = "Không có thông tin pháp lý liên quan trong cơ sở dữ liệu.";
    }

    // 4. Gọi LLM (Groq) để tạo câu trả lời
    const systemPrompt = `Bạn là một trợ lý luật sư AI. Nhiệm vụ của bạn là trả lời câu hỏi dựa TRÊN CÁC TÀI LIỆU được cung cấp bên dưới. 
Tuyệt đối không suy đoán. Nếu thông tin không có trong tài liệu, hãy trả lời: "Không đủ thông tin để kết luận".
Khi sử dụng thông tin từ tài liệu, hãy trích dẫn tên tài liệu đó.

NGỮ CẢNH:
${contextText}`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      model: 'mixtral-8x7b-32768', 
      temperature: 0.1, 
      stream: false, 
    });

    const aiResponse = completion.choices[0].message.content;

    // 5. Trả về câu trả lời kèm trích dẫn
    return NextResponse.json({
      role: 'assistant',
      content: aiResponse,
      citations: [...new Set(citations)] // Loại bỏ trùng lặp
    });

  } catch (error: any) {
    console.error("Lỗi API Chat:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
