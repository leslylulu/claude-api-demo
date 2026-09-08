import { useRef, useState } from "react";
import type Anthropic from "@anthropic-ai/sdk";
import type { UsageInfo } from "@/lib/pricing";

// `stopped` is UI metadata, not part of the API payload — it has to be
// stripped before the message is sent, or the API rejects the extra field.
// `usage` is the same: what that turn cost, kept for display only.
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

    // declared outside try so finally can read them
    let answer: Anthropic.ContentBlockParam[] = [];
    let usage: UsageInfo | undefined;
    let completed = false;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: toPayload(history) }),
        signal: controller.signal,
      });

      // the status locks once streaming starts, so check it here
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      // NDJSON and with frame
      let buffer = "";

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
            console.log("frame ===", frame  );
            if (frame.type === "text") {
              // Merge into the trailing text block instead of pushing one per
              // delta: a long answer would otherwise become hundreds of blocks,
              // and markdown spanning a chunk boundary (`**bo` + `ld**`) would
              // be parsed in halves and never render.
              const last = answer.at(-1);
              answer = last?.type === "text"
                  ? [...answer.slice(0, -1), { ...last, text: last.text + frame.text }]
                  : [...answer, { type: "text", text: frame.text }];
              setReply(answer);
            } else if (frame.type === "tool_use") {
              // its own block — the next text delta starts a fresh one, which is
              // what separates the preamble from the post-tool answer
              answer = [
                ...answer,
                { type: "tool_use", id: frame.id, name: frame.name, input: frame.input }
              ];
              setReply(answer);
            } else if (frame.type === "usage") {
              usage = frame;
            } else if (frame.type === "error") {
              // arrives inside a 200 response — the status was spent on the first byte, so this is the only channel left
              throw new Error(frame.message);
            }
          }
        }
      }

      completed = true;
    } catch (err) {
      // ask the controller whether this was a user stop, instead of guessing
      // from the shape of the error object
      if (!controller.signal.aborted) {
        console.error("Error sending message:", err);
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Something went wrong. Please try again."
        );
      }
    } finally {
      
      // filter tool_use here!
      const textOnly = answer.filter((b) => b.type === "text");

      if ((completed || controller.signal.aborted) && textOnly.some((b) => b.text.trim())) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: textOnly,
            stopped: controller.signal.aborted,
            // absent on an aborted turn — the usage frame is the last thing
            // written, so stopping early means it never arrived
            usage,
          },
        ]);
      }
      setReply([]); // it lives in history now — leaving it here shows it twice
      setStreaming(false);
      abortRef.current = null;
    }
  };

  return { messages, reply, error, streaming, send, stop };
}
