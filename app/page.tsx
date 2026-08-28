"use client";

import { useRef, useState } from "react";

export default function Home() {
  const [input, setInput] = useState("");
  const [reply, setReply] = useState("");
  // "streaming" instead of "loading": the first token arrives in ~200ms, so the
  // meaningful state is "still receiving", not "waiting for the answer".
  const [streaming, setStreaming] = useState(false);

  // A ref, not state: the controller is a mutable handle we only ever read
  // inside callbacks. Putting it in state would re-render for nothing.
  const abortRef = useRef<AbortController | null>(null);

  const stopStreaming = () => abortRef.current?.abort();

  const sendMessage = async () => {
    if (streaming) return; // guard against double submits

    const controller = new AbortController();
    abortRef.current = controller;

    setStreaming(true);
    setReply(""); // clear the previous answer before a new one streams in
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: input }),
        // Wires up the whole cancel chain:
        // abort() -> fetch aborts -> route.ts cancel() -> stream.abort()
        signal: controller.signal,
      });

      // Errors thrown BEFORE the stream opens are normal HTTP status codes.
      // Once the first byte is sent the status is locked, so check it here.
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      // this api does not return a json, it returns a stream of text/plain,
      // so we need to read the stream and convert it to text

      // res.body is a ReadableStream, we can use getReader() to read it
      // getReader is like lock the faucet, and we can read the water from the faucet


      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let result = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          // decode ONCE per chunk — the decoder is stateful, so decoding the
          // same bytes twice corrupts multi-byte characters
          const chunk = decoder.decode(value, { stream: true });
          console.log("Received chunk:", chunk);
          result += chunk;
          setReply(result);
        }
      }
    } catch (error) {
      // Aborting is a user action, not a failure — keep whatever streamed in
      // so far instead of replacing it with an error message.
      if (error instanceof DOMException && error.name === "AbortError") return;

      console.error("Error sending message:", error);
      setReply("An error occurred while sending the message.");
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }
      

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        <input
          className="w-full rounded-md border border-zinc-200 bg-white px-4 py-2 text-zinc-900 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 sm:text-sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
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
        <p className="mt-4 text-zinc-700 dark:text-zinc-300">{reply}</p>
      </main>
    </div>
  );
}
