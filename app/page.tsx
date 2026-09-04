"use client";
import { memo, useState } from "react";
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

  // TODO: render image / tool_use blocks too
  return content.map((block, i) => (
    <div key={i}>
      {block.type === "text" ? (
        <Markdown remarkPlugins={remarkPlugins}>{block.text}</Markdown>
      ) : null}
    </div>
  ));
}

// The three prompt-token fields are disjoint and priced differently:
// cached ~0.1x, new 1.25x (write), fresh 1x. Hence three numbers, not one.
function UsageLine({ usage }: { usage: NonNullable<ChatMessage["usage"]> }) {
  const s = summarize(usage);

  // caching needs a 1024-token minimum prefix, so short chats show zeros
  return (
    <div className="mt-1 font-mono text-[11px] text-(--muted)">
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
    <div className={`text-foreground`}>
      {
        message.role === "assistant" && <strong className="text-xs text-(--muted)">Assistant</strong>
      }
      <div className={`flex flex-col rounded-lg ${message.role === "user" ? "items-end px-3 py-2 bg-(--bubble-user)" : "items-start p-0"}`}>
        {/* w-full: parent is flex-col, items-start shrinks to fit-content. max-w-none: drops prose's 65ch measure. */}
        <div className={`prose prose-sm w-full max-w-none ${streaming ? "streaming" : ""}`}>
          {renderContent(message.content)}
        </div>
      </div>

      {message.usage && !streaming && <UsageLine usage={message.usage} />}

      {message.stopped && (
        <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
          stopped by you
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
        </div>
      )}
    </div>
  );
});

export default function Home() {
  const [input, setInput] = useState("");
  const { messages, reply, error, streaming, send, stop } = useChat();

  const submit = () => {
    send(input);
    setInput("");
  };

  const isEmpty = messages.length === 0 && !streaming;

  return (
    <div className="flex flex-1 flex-col items-center bg-background font-sans">
      <main className="flex w-full max-w-3xl flex-1 flex-col justify-between px-8 py-16">
        <div className="w-full space-y-4">
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
        </div>

        <div className="w-full">
          <input
            className="w-full rounded-xl border border-(--border) bg-(--bubble-user) px-4 py-3 text-foreground outline-none focus:border-(--accent) sm:text-sm"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />

          <div className="flex w-full justify-end">
            <button
              className={`mt-4 rounded-md px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                streaming
                  ? "bg-(--muted)"
                  : "bg-(--accent) hover:opacity-90"
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
