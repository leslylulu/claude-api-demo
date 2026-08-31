"use client";

import { useState } from "react";
import type Anthropic from "@anthropic-ai/sdk";
import { useChat } from "@/hooks/useChat";

function renderContent(content: Anthropic.MessageParam["content"]) {
  if (typeof content === "string") return content;

  // TODO: render image / tool_use blocks too
  return content.map((block, i) => (
    <div key={i}>{block.type === "text" ? block.text : null}</div>
  ));
}

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
            <div key={i} className="text-zinc-700 dark:text-zinc-300">
              <strong>{msg.role}:</strong>
              <div>{renderContent(msg.content)}</div>

              {msg.stopped && (
                <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
                  <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
                  stopped by you
                  <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
                </div>
              )}
            </div>
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
