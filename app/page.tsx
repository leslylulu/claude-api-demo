"use client";

import { useState } from "react";

export default function Home() {
  const [input, setInput] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);

  const sendMessage = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: input }),
      });

      const data = await response.json();
      setReply(data.text);
    } catch (error) {
      console.error("Error sending message:", error);
      setReply("An error occurred while sending the message.");
    } finally {
      setLoading(false);
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
          className="mt-4 rounded-md bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          onClick={sendMessage}
        >
          {loading ? "Loading..." : "Send"}
        </button>
        <p className="mt-4 text-zinc-700 dark:text-zinc-300">{reply}</p>
      </main>
    </div>
  );
}
