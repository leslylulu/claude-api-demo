"use client";
import { memo, useState, useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type Anthropic from "@anthropic-ai/sdk";
import { useChat, type ChatMessage } from "@/hooks/useChat";
import { summarize } from "@/lib/pricing";

// GFM: tables, strikethrough, task list
const remarkPlugins = [remarkGfm];

function renderContent(content: Anthropic.MessageParam["content"]) {
  if (typeof content === "string") {
    return <Markdown remarkPlugins={remarkPlugins}>{content}</Markdown>;
  }

  // TODO: render image
  return content.map((block, i) => {
    if(block.type === "text") {
      return (
        <div key={i}>
          <Markdown remarkPlugins={remarkPlugins}>{block.text}</Markdown>
        </div>
      );
    }

    if (block.type === "tool_use") {
      return <ToolCall key={i} name={block.name} input={block.input} />;
    }

    if( block.type === "tool_result"){
      return <ToolResult key={i} content={block.content} isError={block.is_error} />;
    }

    return null;
  });
}

// tool call = metadata, not answer
function ToolCall({ name, input }: { name: string; input: unknown }) {
  const args =
    input && typeof input === "object"
      ? Object.entries(input as Record<string, unknown>)
      : [];

  return (
    <div className="not-prose my-3 border-l-2 border-(--accent) pl-3 font-mono">
      <div className="text-xs text-foreground">{name}</div>
      {args.map(([key, value]) => (
        <div key={key} className="text-[11px] text-(--muted)">
          {key}: {typeof value === "string" ? value : JSON.stringify(value)}
        </div>
      ))}
    </div>
  );
}

// tool output collapsed, zero JS
function ToolResult({
  content,
  isError
}: {
  content: Anthropic.ToolResultBlockParam["content"];
  isError?: boolean
}) {
  const text =
    typeof content === "string"
      ? content
      : (content?.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n") ?? "");

  let body = text;
  try {
    body = JSON.stringify(JSON.parse(text), null, 2);
  } catch {}

  return (
    <details className={`not-prose my-3 border-l-2 pl-3 font-mono ${isError ? "border-red-500" : "border-(--border)"}`}>
      <summary className="cursor-pointer text-[11px] text-(--muted)">
        {isError ? "error" : "result"} · {text.length} chars
      </summary>
      <pre className="mt-1 max-h-64 overflow-auto text-[11px] leading-relaxed text-(--muted)">
        {body}
      </pre>
    </details>
  );
}

// three disjoint token fields, priced differently
function UsageLine({ usage }: { usage: NonNullable<ChatMessage["usage"]> }) {
  const s = summarize(usage);

  // caching needs a 1024-token minimum prefix
  return (
    <div className="font-mono text-[11px] text-(--muted)">
      {s.promptTokens} in ({s.cacheRead} cached · {s.cacheWrite} new ·{" "}
      {s.uncached} fresh) → {s.outputTokens} out
      {s.cost !== null && ` · $${s.cost.toFixed(5)}`}
    </div>
  );
}

// memo: skip re-render while streaming
const Message = memo(function Message({ 
  message, 
  streaming,
  onRetry
}: { 
  message: ChatMessage, 
  streaming?: boolean,
  onRetry?: () => void
}) {

  const isToolResult = Array.isArray(message.content) &&
    message.content.length > 0 &&
    message.content.every((b) => b.type === "tool_result");

  const isUserBubble = message.role === 'user' && !isToolResult;
  return (
    <div className={`flex flex-col gap-1 ${isUserBubble ? "items-end" : ""}`}>
      <div className={`${isUserBubble ? "bg-(--bubble-user) max-w-[80%] px-4 py-2 rounded-2xl" : ""} ${message.failed ? "opacity-50" : ""}`}>
        <div className={`prose prose-sm max-w-none ${streaming ? "streaming" : ""}`}>
          {renderContent(message.content)}
        </div>
      </div>

      {message.usage && !streaming && <UsageLine usage={message.usage} />}

      {message.stopped && (
        <div className="flex items-center gap-2 text-xs text-(--muted)">
          <span className="h-px flex-1 bg-(--border)" />
          stopped by you
          <span className="h-px flex-1 bg-(--border)" />
        </div>
      )}

      {message.failed && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-xs text-red-500 underline underline-offset-2 hover:no-underline"
        >
          Failed to send · Retry
        </button>
      )}
    </div>
  );
});

export default function Home() {
  const [input, setInput] = useState("");
  const { messages, reply, error, streaming, send, stop, retry } = useChat();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const stickToBottom = useRef(true); // ref: no re-render

  useEffect(() => {
    // don't yank the user back down
    if (stickToBottom.current) bottomRef.current?.scrollIntoView();
  }, [reply, messages]);

  // auto-grow: reset to auto first
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  const submit = () => {
    send(input);
    setInput("");
  };
  

  // records state, scrolls nothing
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    // within 100px of the bottom = sticking
    stickToBottom.current = scrollHeight - scrollTop - clientHeight < 100;
  };


  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return; // IME preedit
    // Shift+Enter = newline
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault(); 
      submit();
    }
  }

  const isEmpty = messages.length === 0 && !streaming;

  return (
    <div className="flex flex-1 flex-col items-center bg-gray-50 font-sans">
      {/* dvh = dynamic viewport height */}
      <main className="flex w-full h-dvh max-w-3xl flex-col bg-white">

        <div 
          ref={scrollRef} 
          onScroll={handleScroll} 
          className="w-full space-y-4 flex-1 overflow-y-auto overscroll-contain px-8 py-16"
        >
          {isEmpty && (
            <h2 className="text-(--muted)">
              Welcome to use the chatbot!
            </h2>
          )}

          {messages.map((msg, i) => (
            <Message key={i} message={msg} onRetry={ msg.failed ? retry : undefined} />
          ))}

          {/* in-flight answer, after history */}
          {streaming && (
            <Message streaming message={{role: "assistant", content: reply}} />
          )}


          {error && <p className="text-red-500">{error}</p>}

          <div ref={bottomRef} />

        </div>

        <div className="flex flex-col gap-2 px-8 pb-8">
          <textarea
            ref={textareaRef}
            className="max-h-48 w-full resize-none overflow-y-auto rounded-xl border border-(--border) bg-(--bubble-user) px-4 py-3 text-foreground outline-none focus:border-(--accent) sm:text-sm"
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
          />

          <div className="flex w-full justify-end">
            <button
              className={`rounded-md px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${
                streaming ? "bg-(--muted)" : "bg-(--accent) hover:opacity-90"
              }`}
              onClick={streaming ? stop : submit}
            >
              {streaming ? "Stop" : "Send"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
