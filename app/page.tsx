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

  // TODO: render image / tool_result blocks too
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

    return null;
  });
}

// A tool call is metadata about how the answer was produced, not part of the
// answer — a rule, not a box. not-prose keeps the typography plugin off it.
function ToolCall({ name, input }: { name: string; input: unknown }) {
  const args =
    input && typeof input === "object"
      ? Object.entries(input as Record<string, unknown>)
      : [];

  return (
    <div className="not-prose my-3 border-l-2 border-(--accent) pl-3 font-mono">
      <div className="text-xs text-(--foreground)">{name}</div>
      {args.map(([key, value]) => (
        <div key={key} className="text-[11px] text-(--muted)">
          {key}: {typeof value === "string" ? value : JSON.stringify(value)}
        </div>
      ))}
    </div>
  );
}

// The three prompt-token fields are disjoint and priced differently:
// cached ~0.1x, new 1.25x (write), fresh 1x. Hence three numbers, not one.
function UsageLine({ usage }: { usage: NonNullable<ChatMessage["usage"]> }) {
  const s = summarize(usage);

  // caching needs a 1024-token minimum prefix, so short chats show zeros
  return (
    <div className="font-mono text-[11px] text-(--muted)">
      {s.promptTokens} in ({s.cacheRead} cached · {s.cacheWrite} new ·{" "}
      {s.uncached} fresh) → {s.outputTokens} out
      {s.cost !== null && ` · $${s.cost.toFixed(5)}`}
    </div>
  );
}

// memo: appending keeps past message objects referentially identical, so they
// skip re-render while a new answer streams. Markdown parsing is worth the compare.
const Message = memo(function Message({ message, streaming }: { message: ChatMessage, streaming?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 ${message.role === "user" ? "items-end" : ""}`}>
      <div className={`${message.role === "user" ? "bg-(--bubble-user) max-w-[80%] px-4 py-2 rounded-2xl" : ""}`}>
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
    </div>
  );
});

export default function Home() {
  const [input, setInput] = useState("");
  const { messages, reply, error, streaming, send, stop } = useChat();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  //* does the user still want to follow along and no need for re-rendering!
  const stickToBottom = useRef(true);

  useEffect(() => {
    // fixed while scrolling, but if the user scrolls up and then a new message arrives,
    //  we don't want to yank them back down. So we only scroll if they were already at the bottom.

    // > 0 means the user has scrolled up, so we don't scroll down automatically.
    if (stickToBottom.current) bottomRef.current?.scrollIntoView();
  }, [reply, messages]);

  // scrollHeight never reports less than the current height, so the box could
  // only ever grow without the reset-to-auto first. The pair is load-bearing.
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
    // clientHeight is the viewport height, 
    // scrollHeight is the total height of the content, 
    // and scrollTop is how far we've scrolled from the top.

    // If the user is within 100px of the bottom, we consider them to be "sticking to the bottom".
    stickToBottom.current = scrollHeight - scrollTop - clientHeight < 100;
    // console.log("scrollTop:", scrollTop, "scrollHeight:", scrollHeight, "clientHeight:", clientHeight, scrollHeight - scrollTop - clientHeight, "stickToBottom:", stickToBottom.current);
  };


  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    // Shift+Enter falls through to the textarea's own newline handling
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault(); 
      submit();
    }
  }

  const isEmpty = messages.length === 0 && !streaming;

  // console.log("messages ===", messages);

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
            <Message key={i} message={msg} />
          ))}

          {/* in-flight answer — after history, so order stays chronological */}
          {streaming && (
            <Message streaming message={{role: "assistant", content: reply}} />
          )}


          {error && <p className="text-red-500">{error}</p>}

          <div ref={bottomRef} />

        </div>

        {/* 3. auto-grow */}
        {/* 4. disable on streaming */}
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
              disabled={!streaming && !input.trim()}
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
