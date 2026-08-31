"use client";

import { useRef, useState } from "react";
import type Anthropic from "@anthropic-ai/sdk";

// role is "user" | "assistant" on this model. The SDK type also allows
// "system", but sonnet-4-6 returns 400 for it — the system prompt goes in the
// top-level `system` param in route.ts instead.
function renderContent(content: Anthropic.MessageParam["content"]) {
  if (typeof content === "string") return content;

  // TODO: render image / tool_use blocks too
  return content.map((block, i) => (
    <div key={i}>{block.type === "text" ? block.text : null}</div>
  ));
}

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Anthropic.MessageParam[]>([]);
  const [reply, setReply] = useState(""); // the answer still streaming in
  const [error, setError] = useState("");
  const [streaming, setStreaming] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const stopStreaming = () => abortRef.current?.abort();

  const sendMessage = async () => {
    if (streaming || !input.trim()) return;

    const controller = new AbortController();
    abortRef.current = controller;

    const userMessage: Anthropic.MessageParam = { role: "user", content: input };
    // one local array, two consumers: the state update and the request body
    const history = [...messages, userMessage];

    setMessages(history);
    setInput("");
    setReply("");
    setError("");
    setStreaming(true);

    // declared outside try so finally can read them
    let answer = "";
    let completed = false;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      });

      // the status locks once streaming starts, so check it here
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          answer += decoder.decode(value, { stream: true });
          setReply(answer);
        }
      }

      completed = true;
    } catch (err) {
      // ask the controller whether this was a user stop, instead of guessing
      // from the shape of the error object
      if (!controller.signal.aborted) {
        console.error("Error sending message:", err);
        setError("Something went wrong. Please try again.");
      }
    } finally {
      // the single commit point: an answer moves from the temp buffer into
      // history when it finished, or when the user stopped it part-way
      if ((completed || controller.signal.aborted) && answer.trim()) {
        setMessages((prev) => [...prev, { role: "assistant", content: answer }]);
      }

      setReply(""); // it lives in history now — leaving it here shows it twice
      setStreaming(false);
      abortRef.current = null;
    }
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
            </div>
          ))}

          {/* the in-flight answer, rendered after history so the order stays chronological */}
          {streaming && (
            <div className="text-zinc-700 dark:text-zinc-300">
              <strong>assistant:</strong>
              <div>{reply || "..."}</div>
            </div>
          )}

          {error && <p className="text-red-500">{error}</p>}
        </div>

        <div className="w-full">
          <input
            className="w-full rounded-md border border-zinc-200 bg-white px-4 py-2 text-zinc-900 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 sm:text-sm"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          />

          <div className="flex w-full justify-end">
            <button
              className={`mt-4 rounded-md px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                streaming
                  ? "bg-red-500 hover:bg-red-600 focus:ring-red-500"
                  : "bg-blue-500 hover:bg-blue-600 focus:ring-blue-500"
              }`}
              onClick={streaming ? stopStreaming : sendMessage}
            >
              {streaming ? "Stop" : "Send"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
