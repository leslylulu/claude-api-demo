# Notes

## EOS

> `app/api/chat/route.ts`

**EOS = End Of Sequence** — the model decided to stop generating. In the Messages API it's not a token you see; it's the response's `stop_reason` field.

### `stop_reason` values

| Value           | Meaning                                  |
| --------------- | ---------------------------------------- |
| `end_turn`      | Finished naturally — the real "EOS" case |
| `max_tokens`    | Hit the limit, output may be cut off     |
| `stop_sequence` | Hit a custom stop string                 |
| `tool_use`      | Wants to call a tool                     |
| `pause_turn`    | Paused, resumable                        |
| `refusal`       | Declined for safety — see `stop_details` |

### Custom stop strings (`stop_sequences`)

Pass your own strings and Claude halts the moment it generates one:

```ts
const res = await client.messages.create({
	model: "claude-opus-5",
	max_tokens: 1024,
	stop_sequences: ["</answer>"],
	system: "Wrap your final answer in <answer></answer> tags.",
	messages: [{ role: "user", content: messages }],
});

// res.stop_reason  === "stop_sequence"  ← one of them was hit
// res.stop_sequence === "</answer>"     ← which one matched
// NOTE: the matched string is NOT included in res.content
```

**Industry reality: most production code doesn't use this at all.** The model
knows when to stop (`end_turn`), and format control has better tools now:

- structured outputs — `output_config: { format: {...} }` + a JSON schema
- tool use — return structured data as tool arguments (`stop_reason: "tool_use"`)

Three cases where `stop_sequences` is still genuinely used:

| Case                  | Example                               | Why                                                                                      |
| --------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| ReAct agent loops     | `["Observation:"]`                    | Stop the model from inventing its own tool results (largely replaced by native tool use) |
| Custom delimiters     | `["</answer>", "---END---"]`          | Cut off early once the payload is done — saves tokens                                    |
| Code completion (FIM) | `["\n\n", "\nfunction ", "\nclass "]` | Complete one function only, stop at the next top-level declaration                       |

`["\n\nHuman:"]` shows up in a lot of older tutorials — that's a leftover from the
pre-Messages Text Completions API, where prompts were hand-built as
`\n\nHuman: ...\n\nAssistant:`. Not needed now that `messages[]` handles turns.

### TODO

`route.ts` currently ignores `stop_reason` and just grabs all `text` blocks. Add a check before returning:

```ts
const res = await client.messages.create({ ... });

if (res.stop_reason === "max_tokens") {
	// response was truncated mid-sentence — retry or warn the user
}

const text = res.content
	.filter((item) => item.type === "text")
	.map((item) => item.text)
	.join("");

return Response.json({ text });
```

## ReadableStream

1. writes its answer word by word over several seconds
2. Without a stream, your server waits for the entire answer, then sends it.
3. With a stream, each word goes out the moment Claude produces it.

```tsx
const encoder = new TextEncoder(). // they carry raw bytes.
// TextEncoder is translator from string to bytes,
// TextDecoder is translator from bytes to string
```

### Mental model: a faucet, not a bucket

A normal response is a bucket — fill it completely, then hand it over.
A stream is a tap — open it, and water comes out while the other side drinks.

### What format is it?

**It has no format.** A `ReadableStream` is just a pipe carrying `Uint8Array`
chunks (raw bytes). Whether those bytes mean plain text, SSE, or JSON Lines is
a contract between you and the consumer — and that contract is the
`Content-Type` header. The stream itself doesn't know what it's carrying.

### The controller = a remote with 3 buttons

```ts
const body = new ReadableStream<Uint8Array>({
	// `start` runs ONCE when the stream is created
	async start(controller) {
		try {
			for await (const event of stream) {
				if (
					event.type === "content_block_delta" &&
					event.delta.type === "text_delta"
				) {
					controller.enqueue(encoder.encode(event.delta.text)); // ① push a chunk
				}
			}
			controller.close(); // ② "no more water" — graceful end
		} catch (err) {
			controller.error(err); // ③ leak alarm — abrupt end
		}
	},

	// fires when the client closes the tab / aborts the fetch
	cancel() {
		stream.abort(); // stop paying for tokens nobody will read
	},
});

return new Response(body, {
	headers: { "Content-Type": "text/plain; charset=utf-8" },
});
```

`close()` and `error()` are **mutually exclusive** terminal states — a stream
enters exactly one, and calling the second one throws. That's why `close()`
lives inside the `try`, not in a `finally`.

### Key point: it's PULL-based (backpressure)

The **consumer** sets the pace, not the producer. `pull` is only called when the
internal queue drops below its high water mark — read slowly, and the stream
stops producing. This is what prevents a fast producer from OOM-ing the server.

Run this to feel the difference — `pull` fires only when you `read()`:

```ts
const s = new ReadableStream({
	start() {
		console.log("start: runs once at creation");
	},
	pull(controller) {
		console.log("pull: consumer asked, so now I produce");
		controller.enqueue(Date.now());
	},
});

const reader = s.getReader();
await reader.read(); // logs start → pull
await reader.read(); // logs pull only
```

Our `route.ts` puts everything in `start` (eager) and skips `pull`. Fine here —
Claude is the bottleneck, not the network. For a 2GB file you'd use `pull`.

### Consuming it on the frontend

```ts
const res = await fetch("/api/chat", {
	method: "POST",
	body: JSON.stringify({ messages: input }),
});

const reader = res.body!.getReader();
const decoder = new TextDecoder();

while (true) {
	const { done, value } = await reader.read();
	if (done) break; // this is what controller.close() triggers
	setText(prev => prev + decoder.decode(value, { stream: true }));
}
```

`await res.json()` no longer works — JSON must be complete to parse.

### Pitfalls

1. **Forgot `controller.close()`** → the client hangs forever with no error.
   It's a hang, not a crash, so the console stays clean. Hardest one to debug.
2. **`decode(value)` without `{ stream: true }`** → garbled text. One Chinese char is
   3 bytes and chunks split mid-character. Never reproduces in English tests.
3. **Reading a stream twice** → `TypeError: body stream already read`. Streams
   are single-use; clone with `res.clone()` or `stream.tee()`.
4. **No `cancel()` handler** → user closes the tab, you keep burning tokens.
5. **Setting `Content-Length`** → conflicts with chunked transfer encoding.
   A stream doesn't know its own length.

### When to use

LLM chat (this project) · large file up/download · live logs & progress ·
React SSR streaming · CSV/JSONL export.

**Don't** stream a response that already returns in <1s — that's over-engineering.

### Alternatives

| Option                             | Bidirectional? | Use when                                                  |
| ---------------------------------- | -------------- | --------------------------------------------------------- |
| ReadableStream + plain text (this) | no             | plain text only, simplest                                 |
| SSE                                | no             | structured events (text + status + error), auto-reconnect |
| WebSocket                          | **yes**        | chat rooms, collab editing — client also pushes often     |
| Plain JSON response                | —              | response is already fast                                  |

LLM chat is one-way request/response, so **WebSocket is overkill here**.
Vercel AI SDK (`streamText()` + `useChat()`) wraps all of the above if you'd
rather not hand-write it — at the cost of one more abstraction layer.

## chat/route.ts

### `.stream()` vs `.create()`

Same parameters, different return value. `.create()` gives a `Promise<Message>`
— you wait for the whole answer. `.stream()` gives a `MessageStream` you can
iterate as tokens arrive, and it is **not** awaited on the call itself.

### Why the body is bytes, not a string

`new Response(body)` accepts `string | Blob | ArrayBuffer | FormData |
URLSearchParams | ReadableStream | null`.

A string has to be **complete** before it can be sent — that defeats the whole
point. A byte stream ships each piece the moment it's ready. `TextEncoder` is
what converts `string` → `Uint8Array`, because `ReadableStream` carries bytes.

### Filtering the events

`for await` iterates events the SDK has already parsed out of Anthropic's SSE.
Only `content_block_delta` + `text_delta` is real text — everything else
(`message_start`, `content_block_stop`, `message_delta`, …) is metadata.

```ts
for await (const event of stream) {
	if (
		event.type === "content_block_delta" &&
		event.delta.type === "text_delta"
	) {
		controller.enqueue(encoder.encode(event.delta.text));
	}
}

// resolves when the stream ends, returns the assembled Message —
// this is where stop_reason lives
const final = await stream.finalMessage();
if (final.stop_reason === "max_tokens") {
	controller.enqueue(encoder.encode("\n\n[truncated: hit max_tokens]"));
}
```

### Response headers

| Header                                    | Why                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Content-Type: text/plain; charset=utf-8` | The stream carries bytes and doesn't know what they mean — this is the contract with the client |
| `Cache-Control: no-cache, no-transform`   | `no-transform` stops proxies buffering the stream into one chunk                                |
| `X-Content-Type-Options: nosniff`         | Stops the browser guessing (and buffering to guess) the type                                    |

Never set `Content-Length` — a stream doesn't know its own length, and it
conflicts with chunked transfer encoding.

### Open question

Error status codes: once the first byte is sent the status is locked at 200.
Anything that can fail must be validated **before** `.stream()` is called.

## page.tsx

### `streaming`, not `loading`

The first token arrives in ~200ms, so "waiting for the answer" is a state that
barely exists. The meaningful one is "still receiving" — which is also what
lets the button double as a Stop control.

### `useRef` for the AbortController, not `useState`

The controller is a mutable handle only ever read inside callbacks. Putting it
in state would re-render for nothing.

**Rule of thumb: does the UI need to update when this value changes?**
No → `useRef`. Yes → `useState`.

### The cancel chain

```
stopStreaming()
  → controller.abort()
  → fetch aborts
  → connection drops
  → route.ts cancel()
  → stream.abort()          // Claude stops generating
```

`signal: controller.signal` on the fetch is what wires it all together.

### Swallow AbortError

```ts
catch (error) {
	// Aborting is a user action, not a failure — keep whatever streamed in
	// instead of replacing it with an error message.
	if (error instanceof DOMException && error.name === "AbortError") return;

	console.error("Error sending message:", error);
	setReply("An error occurred while sending the message.");
} finally {
	setStreaming(false);
	abortRef.current = null;
}
```

Without that guard, hitting Stop wipes the text already on screen.
`return` inside `catch` still runs `finally`, so cleanup is unaffected.

### Check `response.ok` before reading

Errors thrown **before** the stream opens are normal HTTP status codes. Once
the first byte is sent the status is locked at 200, so this check has to happen
here — otherwise a 400 body gets streamed onto the page as if it were an answer.

### Decode once per chunk

```ts
const chunk = decoder.decode(value, { stream: true });
result += chunk;
setReply(result);
```

`TextDecoder` is **stateful** — it buffers incomplete multi-byte sequences
between calls. Decoding the same bytes twice (e.g. an extra `console.log(
decoder.decode(value))`) corrupts characters.

Accumulating into a local `result` also sidesteps the stale-closure trap:
`reply` from `useState` is frozen for the whole function call, so
`setReply(reply + chunk)` would never advance. The alternative is the
functional form, `setReply(prev => prev + chunk)`.

## Stateless vs stateful chat

The Messages API is **stateless** — it remembers nothing between calls, so every
request resends the whole history. That's why `page.tsx` keeps a `messages[]`
array and posts all of it each turn.

claude.ai is **stateful**. Its requests go to
`/chat_conversations/{uuid}/...`, the conversation lives in a database, and the
client only sends the new message.

|  | claude.ai | this app |
| --- | --- | --- |
| History lives | server-side DB | browser memory (gone on refresh) |
| Sent per turn | just the new message | the entire array |
| Stopping | `POST .../stop_response` with a `completion_request_id` | close the connection |

### Why claude.ai needs an explicit stop endpoint

**A dropped connection is an ambiguous signal.** The server can't tell apart:

- the user pressed Stop
- the network blipped
- the tab was closed / the laptop slept

Those need different reactions — a blip should *not* kill the generation, a
deliberate stop should. So the intent gets its own request. The
`completion_request_id` identifies *which* generation to stop, since several
can be in flight across tabs and devices, and the server still has to persist
the partial answer so every device sees the same state.

### Why this app doesn't need one

Here the connection **is** the only source of truth:

```
Stop → fetch abort → connection drops → route.ts cancel() → stream.abort()
```

No server-side session to keep in sync, no multi-device consistency, so the
implicit signal is enough. Adding a stop endpoint would first require adding
server-side conversation storage — solving a problem this app doesn't have.

**The trade-off to know:** a network blip and a deliberate stop are
indistinguishable here. Wi-Fi drops, generation dies, and the message gets
labelled "stopped by you" even though it wasn't. Statelessness buys simplicity
and pays for it with lost intent.

### Consecutive user messages

Stopping before the first token means no assistant message is stored (an empty
`content` is rejected by the API), so history can hold two `user` messages in a
row. The API accepts that and merges them into one turn.

claude.ai instead stores the partial answer however short it is, and marks it
stopped. Matching that means dropping the `answer.trim()` guard and storing
placeholder text — which then leaks into the next turn's context. No clean
answer either way.

## System prompt

The instruction that sets the context for the **entire** conversation, not just
one message. What it controls:

- **Who you are** — the AI's role and purpose
- **Output format** — JSON only? no markdown? no prose?
- **Scope** — restrict answers to one topic or domain
- **Tone and style** — formality, length, personality
- **Context** — e.g. "you are a travel agent" plus the user's budget and dates

How to write a good one:

1. Be specific and clear
2. Say what **to do**, not what not to do
3. Use structure — bullets, numbered lists, tables are easier to follow

## TODO — UI (deferred, logic first)

Claude answers in Markdown, but `<p>{reply}</p>` renders it as raw text —
`## headings`, `| tables |`, and `**bold**` all show up as literal characters.

- [ ] Render Markdown instead of plain text (`react-markdown` + `remark-gfm`
      for tables). Sanitize if the input is ever untrusted.
- [ ] Syntax highlighting for code blocks
- [ ] Chat layout — user/assistant bubbles instead of one `<p>`
- [ ] `min-h` on the answer area so the page doesn't jump as text streams in
- [ ] Auto-scroll to the bottom while streaming
- [ ] Blinking cursor at the end of the streaming text

Smoothness note: the burst-y arrival is the model's real rhythm, not a bug.
A true typewriter effect needs a client-side render queue that releases
characters at a fixed rate — pure UI sugar, unrelated to the stream itself.
