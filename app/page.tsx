"use client";
import { memo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type Anthropic from "@anthropic-ai/sdk";
import { useChat, type ChatMessage } from "@/hooks/useChat";
import { summarize } from "@/lib/pricing";

// GitHub Flavored Markdown — tables, strikethrough, task lists, autolinks.
// Plain CommonMark has no table syntax, so without this Claude's tables
// render as literal pipe characters.
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

// The three prompt-token fields are disjoint and priced differently, so they
// are shown separately rather than as one "input" number: `cached` is the
// ~0.1x part, `new` the 1.25x write, `fresh` the full-price remainder.
function UsageLine({ usage }: { usage: NonNullable<ChatMessage["usage"]> }) {
  const s = summarize(usage);

  // minimum cache size is 1024 tokens,
  return (
    <div className="mt-1 font-mono text-[11px] text-zinc-400">
      {s.promptTokens} in ({s.cacheRead} cached · {s.cacheWrite} new ·{" "}
      {s.uncached} fresh) → {s.outputTokens} out
      {s.cost !== null && ` · $${s.cost.toFixed(5)}`}
    </div>
  );
}

// memo skips the re-render when `message` is referentially unchanged. Appending
// to the array keeps existing objects identical, so every past message is
// skipped while a new answer streams in — and markdown parsing is expensive
// enough to be worth the shallow compare.
const Message = memo(function Message({ message }: { message: ChatMessage }) {
  return (
    <div className="text-zinc-700 dark:text-zinc-300">
      {
        message.role === "assistant" && <strong>Assistant</strong>
      }
      <div className={`flex flex-col rounded-lg ${message.role === "user" ? "items-end p-2 bg-pink-100" : "items-start p-0"}`}>
        {renderContent(message.content)}
      </div>

      {message.usage && <UsageLine usage={message.usage} />}

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
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col justify-between py-32 px-16 bg-white dark:bg-black">
        <div className="w-full space-y-4">
          {isEmpty && (
            <h2 className="text-zinc-700 dark:text-zinc-300">
              Welcome to use the chatbot!
            </h2>
          )}

          {messages.map((msg, i) => (
            <Message key={i} message={msg} />
          ))}

          {/* the in-flight answer, rendered after history so the order stays chronological */}
          {streaming && (
            <div className="text-zinc-700 dark:text-zinc-300">
              <strong>assistant:</strong>
              <div>
                {reply}
                <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-zinc-400 align-text-bottom" />
              </div>
            </div>
          )}

          {error && <p className="text-red-500">{error}</p>}
        </div>

        <div className="w-full">
          <input
            className="w-full rounded-md border border-zinc-200 bg-white px-4 py-2 text-zinc-900 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 sm:text-sm"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />

          <div className="flex w-full justify-end">
            <button
              className={`mt-4 rounded-md px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                streaming
                  ? "bg-red-500 hover:bg-red-600 focus:ring-red-500"
                  : "bg-blue-500 hover:bg-blue-600 focus:ring-blue-500"
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
