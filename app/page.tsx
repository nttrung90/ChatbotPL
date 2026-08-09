'use client';

import { useState, useRef, useEffect } from 'react';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  citations?: string[];
};

export default function ChatBot() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...messages, userMessage] }),
      });

      if (!response.ok) throw new Error('Network response was not ok');
      
      const data = await response.json();
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.content,
        citations: data.citations
      }]);
    } catch (error) {
      console.error('Lỗi khi chat:', error);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Có lỗi xảy ra, vui lòng thử lại.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto p-4 font-sans">
      <div className="bg-blue-600 text-white p-4 rounded-t-lg shadow-md">
        <h1 className="text-xl font-bold">Trợ Lý Pháp Luật AI</h1>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 border-x border-gray-200 bg-gray-50 flex flex-col gap-4">
        {messages.map((msg, index) => (
          <div key={index} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-[80%] p-3 rounded-lg shadow-sm ${
              msg.role === 'user' ? 'bg-blue-500 text-white rounded-br-none' : 'bg-white text-gray-800 rounded-bl-none border border-gray-200'
            }`}>
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
            
            {msg.citations && msg.citations.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1 max-w-[80%]">
                {msg.citations.map((cite, i) => (
                  <span key={i} className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded">
                    Nguồn: {cite}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="text-gray-500 text-sm italic">AI đang phân tích tài liệu...</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 p-4 bg-white border border-t-0 border-gray-200 rounded-b-lg shadow-md">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Hỏi về luật..."
          className="flex-1 p-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
          disabled={isLoading}
        />
        <button 
          type="submit" 
          disabled={isLoading}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          Gửi
        </button>
      </form>
    </div>
  );
}