"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, Send, User, RotateCcw } from "lucide-react";

// Simple markdown renderer — no extra deps
function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Heading
    if (line.startsWith("### ")) {
      elements.push(<p key={i} className="font-bold text-[#1A1A2E] mt-2">{inlineFormat(line.slice(4))}</p>);
    } else if (line.startsWith("## ")) {
      elements.push(<p key={i} className="font-bold text-[#1A1A2E] text-base mt-2">{inlineFormat(line.slice(3))}</p>);
    } else if (line.startsWith("# ")) {
      elements.push(<p key={i} className="font-bold text-[#1A1A2E] text-lg mt-2">{inlineFormat(line.slice(2))}</p>);
    // Bullet
    } else if (line.match(/^[-*] /)) {
      elements.push(
        <div key={i} className="flex gap-2 items-start">
          <span className="text-[#6366F1] mt-0.5 font-bold">•</span>
          <span>{inlineFormat(line.slice(2))}</span>
        </div>
      );
    // Numbered list
    } else if (line.match(/^\d+\. /)) {
      const match = line.match(/^(\d+)\. (.*)/);
      if (match) elements.push(
        <div key={i} className="flex gap-2 items-start">
          <span className="text-[#6366F1] font-semibold min-w-[18px]">{match[1]}.</span>
          <span>{inlineFormat(match[2])}</span>
        </div>
      );
    // Code block
    } else if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={i} className="bg-[#F1F5F9] rounded-xl p-3 text-xs font-mono overflow-x-auto my-1 text-[#334155]">
          {codeLines.join("\n")}
        </pre>
      );
    // Blank line = spacer
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-1" />);
    // Normal paragraph
    } else {
      elements.push(<p key={i}>{inlineFormat(line)}</p>);
    }
    i++;
  }
  return <div className="space-y-0.5">{elements}</div>;
}

function inlineFormat(text: string): React.ReactNode {
  // Bold **text**, inline code `text`, links [label](url)
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i} className="font-semibold text-[#1A1A2E]">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={i} className="bg-[#F1F5F9] text-[#6366F1] px-1.5 py-0.5 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch)
      return <a key={i} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="text-[#2563EB] underline hover:text-[#6366F1]">{linkMatch[1]}</a>;
    return part;
  });
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "What is Shyft?",
  "How do gasless transactions work on Solana?",
  "Explain Solana account rent",
  "How does on-chain social work?",
  "What is the Bags creator token protocol?",
  "How is messaging encrypted on Shyft?",
];

export default function AI() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || streaming) return;
    const userMsg: Message = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);

    // Add empty assistant message to stream into
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok || !res.body) throw new Error("Failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: "assistant",
              content: updated[updated.length - 1].content + chunk,
            };
            return updated;
          });
        }
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: "Sorry, something went wrong. Make sure Ollama is running locally.",
        };
        return updated;
      });
    } finally {
      setStreaming(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="max-w-3xl mx-auto h-[calc(100vh-120px)] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-[#E2E8F0]">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#6366F1] to-[#2563EB] flex items-center justify-center shadow-md shadow-indigo-200">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-[#1A1A2E]">Shyft AI</h1>
          <p className="text-xs text-[#64748B]">Your on-chain AI assistant</p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#64748B] hover:text-[#1A1A2E] hover:bg-[#F1F5F9] rounded-lg transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center px-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#6366F1] to-[#2563EB] flex items-center justify-center shadow-lg shadow-indigo-200">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[#1A1A2E] mb-2">How can I help you?</h2>
              <p className="text-sm text-[#64748B]">Ask me anything about Shyft, Solana, or crypto.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 w-full max-w-lg">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="text-left px-3 py-2.5 text-xs font-medium text-[#475569] bg-white border border-[#E2E8F0] rounded-xl hover:border-[#6366F1] hover:text-[#6366F1] hover:bg-[#F5F3FF] transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#6366F1] to-[#2563EB] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
              )}
              <div
                className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-[#2563EB] text-white rounded-br-sm whitespace-pre-wrap"
                    : "bg-white border border-[#E2E8F0] text-[#1A1A2E] rounded-bl-sm"
                }`}
              >
                {msg.role === "user" ? msg.content : renderMarkdown(msg.content)}
                {msg.role === "assistant" && streaming && i === messages.length - 1 && (
                  <span className="inline-block w-1.5 h-4 bg-[#6366F1] rounded-sm ml-1 animate-pulse" />
                )}
              </div>
              {msg.role === "user" && (
                <div className="w-8 h-8 rounded-lg bg-[#F1F5F9] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <User className="w-4 h-4 text-[#64748B]" />
                </div>
              )}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[#E2E8F0] pt-4">
        <div className="flex gap-2 items-end bg-white border border-[#E2E8F0] rounded-2xl px-4 py-3 focus-within:border-[#6366F1] focus-within:ring-2 focus-within:ring-[#6366F1]/10 transition-all">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            rows={1}
            disabled={streaming}
            className="flex-1 resize-none bg-transparent text-sm text-[#1A1A2E] placeholder-[#94A3B8] outline-none max-h-32 disabled:opacity-50"
            style={{ lineHeight: "1.5" }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || streaming}
            className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#6366F1] to-[#2563EB] flex items-center justify-center flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            <Send className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
        <p className="text-[11px] text-[#94A3B8] text-center mt-2">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
