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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Tự động điều chỉnh chiều cao của textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...messages, userMessage] }),
      });

      if (!response.ok) {
        throw new Error(`Lỗi HTTP: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.content,
        citations: data.citations
      }]);
    } catch (error: any) {
      console.error('Lỗi khi chat:', error);
      setMessages(prev => [...prev, { role: 'assistant', content: `Lỗi: ${error.message || 'Có lỗi xảy ra, vui lòng thử lại.'}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white text-gray-800 font-sans">
      {/* Header (Chỉ hiển thị trên mobile, ẩn trên desktop để giống ChatGPT) */}
      <div className="md:hidden flex items-center justify-center p-4 border-b border-gray-200 bg-white sticky top-0 z-10">
        <h1 className="text-lg font-semibold text-gray-800">Trợ Lý Pháp Luật AI</h1>
      </div>
      
      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto pb-32">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-gray-600">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75Z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Trợ Lý Pháp Luật</h2>
            <p className="text-gray-500">Tôi có thể giúp gì cho bạn hôm nay?</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {messages.map((msg, index) => (
              <div key={index} className={`w-full ${msg.role === 'assistant' ? 'bg-white' : 'bg-white'}`}>
                <div className="max-w-3xl mx-auto px-4 py-6 flex gap-4 md:gap-6">
                  
                  {/* Icon / Avatar */}
                  {msg.role === 'assistant' && (
                    <div className="flex-shrink-0 w-8 h-8 border border-gray-200 rounded-full flex items-center justify-center bg-white shadow-sm">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-gray-700">
                        <path fillRule="evenodd" d="M9 4.5a.75.75 0 0 1 .721.544l.813 2.846a3.75 3.75 0 0 0 2.576 2.576l2.846.813a.75.75 0 0 1 0 1.442l-2.846.813a3.75 3.75 0 0 0-2.576 2.576l-.813 2.846a.75.75 0 0 1-1.442 0l-.813-2.846a3.75 3.75 0 0 0-2.576-2.576l-2.846-.813a.75.75 0 0 1 0-1.442l2.846-.813A3.75 3.75 0 0 0 7.466 7.89l.813-2.846A.75.75 0 0 1 9 4.5ZM18 1.5a.75.75 0 0 1 .728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 0 1 0 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 0 1-1.456 0l-.258-1.036a2.625 2.625 0 0 0-1.91-1.91l-1.036-.258a.75.75 0 0 1 0-1.456l1.036-.258a2.625 2.625 0 0 0 1.91-1.91l.258-1.036A.75.75 0 0 1 18 1.5ZM16.5 15a.75.75 0 0 1 .712.513l.394 1.183c.15.447.5.799.948.948l1.183.395a.75.75 0 0 1 0 1.422l-1.183.395c-.447.15-.799.5-.948.948l-.395 1.183a.75.75 0 0 1-1.422 0l-.395-1.183a1.5 1.5 0 0 0-.948-.948l-1.183-.395a.75.75 0 0 1 0-1.422l1.183-.395c.447-.15.799-.5.948-.948l.395-1.183A.75.75 0 0 1 16.5 15Z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                  
                  {/* Message Content */}
                  <div className={`flex flex-col w-full ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`text-base leading-relaxed whitespace-pre-wrap px-5 py-3 ${
                      msg.role === 'user' 
                        ? 'bg-gray-100 text-gray-900 rounded-3xl rounded-tr-sm max-w-[85%]' 
                        : 'text-gray-800 w-full'
                    }`}>
                      {msg.content}
                    </div>

                    {/* Citations */}
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {msg.citations.map((cite, i) => (
                          <div key={i} className="inline-flex items-center px-3 py-1.5 rounded-xl text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200 shadow-sm cursor-help hover:bg-gray-100 transition-colors" title={`Trích dẫn từ: ${cite}`}>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5 mr-1.5 text-blue-500">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                            </svg>
                            {cite.split(' (')[0]}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            
            {/* Loading Indicator */}
            {isLoading && (
              <div className="w-full bg-white">
                <div className="max-w-3xl mx-auto px-4 py-6 flex gap-4 md:gap-6">
                  <div className="flex-shrink-0 w-8 h-8 border border-gray-200 rounded-full flex items-center justify-center bg-white shadow-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-gray-400 animate-pulse">
                      <path fillRule="evenodd" d="M9 4.5a.75.75 0 0 1 .721.544l.813 2.846a3.75 3.75 0 0 0 2.576 2.576l2.846.813a.75.75 0 0 1 0 1.442l-2.846.813a3.75 3.75 0 0 0-2.576 2.576l-.813 2.846a.75.75 0 0 1-1.442 0l-.813-2.846a3.75 3.75 0 0 0-2.576-2.576l-2.846-.813a.75.75 0 0 1 0-1.442l2.846-.813A3.75 3.75 0 0 0 7.466 7.89l.813-2.846A.75.75 0 0 1 9 4.5Z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-500 h-8">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }}></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-white via-white to-transparent pt-6 pb-6 px-4">
        <div className="max-w-3xl mx-auto">
          <form 
            onSubmit={handleSubmit} 
            className="relative flex items-end bg-gray-100/80 backdrop-blur-md border border-gray-200 rounded-3xl p-2 shadow-sm focus-within:ring-1 focus-within:ring-gray-300 focus-within:bg-gray-100 transition-all"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Nhập câu hỏi pháp lý..."
              className="flex-1 max-h-48 min-h-[44px] bg-transparent resize-none outline-none px-4 py-3 text-gray-800 placeholder-gray-500 overflow-y-auto"
              disabled={isLoading}
              rows={1}
            />
            <button 
              type="submit" 
              disabled={isLoading || !input.trim()}
              className="mb-1 mr-1 p-2 rounded-full bg-black text-white disabled:bg-gray-300 disabled:text-gray-500 transition-colors flex-shrink-0"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M11.47 2.47a.75.75 0 0 1 1.06 0l7.5 7.5a.75.75 0 1 1-1.06 1.06l-6.22-6.22V21a.75.75 0 0 1-1.5 0V4.81l-6.22 6.22a.75.75 0 1 1-1.06-1.06l7.5-7.5Z" clipRule="evenodd" />
              </svg>
            </button>
          </form>
          <div className="text-center mt-3 text-xs text-gray-400">
            Trợ Lý Pháp Luật AI có thể mắc lỗi. Hãy kiểm chứng các trích dẫn tài liệu.
          </div>
        </div>
      </div>
    </div>
  );
}
