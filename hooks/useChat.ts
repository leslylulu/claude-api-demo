import { useRef, useState } from "react";
import type Anthropic from "@anthropic-ai/sdk";
import type { UsageInfo } from "@/lib/pricing";

// UI-only fields, stripped before send
export type ChatMessage = Anthropic.MessageParam & {
  stopped?: boolean;
  usage?: UsageInfo;
};

const toPayload = (messages: ChatMessage[]): Anthropic.MessageParam[] =>
  messages.map(({ role, content }) => ({ role, content }));

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [reply, setReply] = useState<Anthropic.ContentBlockParam[]>([]); // the answer still streaming in

  const [error, setError] = useState("");
  const [streaming, setStreaming] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const stop = () => abortRef.current?.abort();

  const send = async (text: string) => {
    if (streaming || !text. trim()) return;

    const controller = new AbortController();
    abortRef.current = controller;

    const userMessage: ChatMessage = { role: "user", content: text };
    const history = [...messages, userMessage];

    setMessages(history);
    setReply([]);
    setError("");
    setStreaming(true);

    let answerText = ""; // only text streams delta by delta

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: toPayload(history) }),
        signal: controller.signal,
      });

      // status locks once streaming starts
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      let buffer = ""; // NDJSON

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? ""; // the trailing partial line

          for (const line of lines) {
            if (!line) continue;
            const frame = JSON.parse(line);
            if (frame.type === "text") {
              answerText += frame.text; // one growing string
              setReply([{ type: "text", text: answerText }]); // new array = new reference
            } else if (frame.type === "turn") {
              setMessages((prev) => [...prev, { role: "assistant", content: frame.content }]);
              answerText = "";
              setReply([]);
            } else if (frame.type === "tool_result") {
              setMessages((prev) => [...prev, { role: "user", content: frame.content }]);
            } else if (frame.type === "usage") {
              setMessages((prev) => 
                prev.map((msg, index) => (index === prev.length - 1 ? 
                  {...msg, usage: frame} : msg)
                )
              )
            } else if (frame.type === "error") {
              // arrives inside a 200
              throw new Error(frame.message);
            }
          }
        }
      }

    } catch (err) {
      // user stop, not a failure
      if (!controller.signal.aborted) {
        console.error("Error sending message:", err);
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Something went wrong. Please try again."
        );
      }
    } finally {
      // stop: commit the partial answer
      if (controller.signal.aborted && answerText.trim()) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: [{ type: "text", text: answerText }],
            stopped: true
          },
        ]);
      }
      setReply([]); // lives in history now
      setStreaming(false);
      abortRef.current = null;
    }
  };

  return { messages, reply, error, streaming, send, stop };
}
