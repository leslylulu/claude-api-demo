import { useRef, useState } from "react";
import type Anthropic from "@anthropic-ai/sdk";
import type { UsageInfo } from "@/lib/pricing";

// UI-only fields, stripped before send
export type ChatMessage = Anthropic.MessageParam & {
  stopped?: boolean;
  usage?: UsageInfo;
  failed?: boolean
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
    // no failed msg 
    const history = [...messages.filter((m) => !m.failed), userMessage];

    setMessages(history);
    setStreaming(true);
    setReply([]);
    setError("");

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
        // based on obj reference not index
        setMessages((prev) => prev.map((m) => m === userMessage ? {...m, failed: true} : m))
      }
    } finally {
      // stop: commit the partial answer
      if (controller.signal.aborted) {
        setMessages((prev) => {
          if(answerText.trim()){
            return [
              ...prev,
              {
                role: "assistant",
                content: [{type: "text", text: answerText}],
                stopped: true
              }
            ]
          }
          
          const last = prev.at(-1)
          if(last?.role !== 'assistant' || !Array.isArray(last?.content)){
            return prev;
          }

          const pending = last.content.filter(b => b.type === 'tool_use')
          if (pending.length === 0){
            return prev
          }

          return [
            ...prev,
            {
              role: "user",
              content: pending.map((b) => ({
                type: "tool_result" as const,
                tool_use_id: b.id,
                content: JSON.stringify({error: "Cancelled By User"}),
                is_error: true,
              })),
            },
          ]
        });
      }
      setReply([]); // lives in history now
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const retry = () => {
    const failed = messages.findLast((m) => m.failed)

    if(failed && typeof failed.content === 'string'){
      send(failed.content)
    }
  }

  return { messages, reply, error, streaming, send, stop, retry };
}
