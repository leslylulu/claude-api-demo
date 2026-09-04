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

## Prompt caching + token counting

### The wire format had to change first

Usage totals only exist *after* the last token. Headers are locked once the
first byte ships, so there was nowhere to put them — plain text can carry the
answer and nothing else.

Fix: **NDJSON** (`application/x-ndjson`) — one JSON object per line, two frame
types. `JSON.stringify` escapes newlines inside strings, so a raw `\n` is
unambiguously a separator and can never appear inside a frame.

```ts
type Frame =
	| { type: "text"; text: string }
	| { type: "usage"; model: string; stop_reason: ...; usage: Anthropic.Usage };

const frame = (f: Frame) => encoder.encode(JSON.stringify(f) + "\n");
```

This is the "SSE" row of the alternatives table above, minus the `event:` /
`data:` ceremony and auto-reconnect. Take real SSE when you want those.

### Framing means the client needs a buffer

The network hands you arbitrary byte chunks. One chunk can hold three lines,
or end mid-line. **Only the text after the last `\n` is incomplete:**

```ts
let buffer = "";

buffer += decoder.decode(value, { stream: true });
const lines = buffer.split("\n");
buffer = lines.pop() ?? ""; // trailing partial line — wait for the rest

for (const line of lines) {
	if (!line) continue;
	const frame = JSON.parse(line);
	if (frame.type === "text") { answer += frame.text; setReply(answer); }
	else if (frame.type === "usage") { usage = frame; }
}
```

Two decoders now, stacked: `TextDecoder` buffers partial *bytes*, this buffers
partial *lines*. Skipping the second one throws `Unexpected end of JSON input`
— only on long answers, never in a short local test.

### One line enables caching

```ts
const stream = client.messages.stream({
	model: MODEL,
	cache_control: { type: "ephemeral" }, // top-level = automatic
	system: SYSTEM_PROMPT,
	messages,
});
```

Top-level `cache_control` auto-places one breakpoint on the last cacheable
block — which, as the array grows, is always the newest turn. So each request
reads the whole prior conversation and writes only the delta. The manual
equivalent is `cache_control` on `messages.at(-1)`; automatic needs no
bookkeeping and is the right default for multi-turn chat.

Reach for explicit breakpoints when the prompt **ends** in per-request content
(retrieved rows, a one-off question) — the automatic breakpoint lands after
that unique tail, so every request pays the write premium on bytes nobody ever
reads back. Then put the marker at the end of the *shared* part instead.

### It's a prefix match — that's the whole model

Render order is `tools` → `system` → `messages`. One changed byte anywhere in
the prefix invalidates everything after it. So the silent killers all live at
the front:

| Anti-pattern | Why it kills the cache |
| --- | --- |
| `Date.now()` / a UUID in the system prompt | prefix differs every request |
| `if (flag) system += ...` | each flag combo is a distinct prefix |
| `JSON.stringify` over an unordered object | bytes differ run to run |
| adding/reordering a tool mid-conversation | tools render at position 0 |
| switching models mid-conversation | caches are model-scoped |

That's why `SYSTEM_PROMPT` is a module-scope const and not a template built
per request. To inject something dynamic, put it *after* the history — never
in `system`.

### The three token fields are disjoint

`input_tokens` is the **uncached remainder only**. Real prompt size is the sum:

```
promptTokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens
```

An agent that ran for an hour showing `input_tokens: 4000` is not a small
prompt — it's a well-cached one. Reading that field alone is the classic
misread.

### Measured on this app

Two requests sharing a ~3.6K-token prefix:

| | `input` | `cache_creation` | `cache_read` |
| --- | ---: | ---: | ---: |
| cold | 3 | 3,643 | 0 |
| warm | 3 | 15 | 3,643 |

That second row is the **healthy-loop signature**: read everything so far,
write only what the last turn added. Effective input on turn 2 is
`3 + 3643×0.1 + 15×1.25 ≈ 386` billed tokens instead of 3,661 — ~89% off.

If `cache_creation` is near the full conversation size on *every* request, the
prefix is being rewritten upstream. If `cache_read` is flat zero, see the
anti-pattern table.

### Economics

Reads cost **0.1×** base input. Writes cost **1.25×** (5-min TTL) or **2×**
(1-hour TTL). So a 5-minute entry breaks even on the second request
(1.25 + 0.1 = 1.35 vs 2.0 uncached); a 1-hour entry needs a third.

A read **refreshes the timer for free**, measured from the *start* of the
request. So continuous traffic keeps a 5-minute entry alive forever, and the
1-hour TTL buys nothing but a doubled write price. It only pays in the 5–60
minute gap — a user who replies after 20 minutes.

### The gotcha: minimum cacheable prefix

Below the minimum, caching **silently does nothing** — no error, just
`cache_creation_input_tokens: 0`. And the minimum is *not* monotonic across
generations:

| Model | Minimum |
| --- | ---: |
| Opus 5 | 512 |
| Sonnet 5, **Sonnet 4.6** | 1,024 |
| Opus 4.7 | 2,048 |
| Opus 4.6, Haiku 4.5 | 4,096 |

Our `SYSTEM_PROMPT` is ~80 tokens. **Caching it alone would never have done
anything** — the win only exists because the breakpoint sits on the growing
conversation. Short chats in this app will still show all zeros; that's
correct, not a bug. Test with a long prefix (above) or don't trust the result.

### TODO

- [ ] Verify caching still works after *any* change to prompt assembly. The
      costly failure mode is silent: requests keep succeeding, the bill is
      just higher. An assertion that a second identical request has
      `cache_read_input_tokens > 0` is worth more than a one-time eyeball.
- [ ] Session total, not just per-message — sum usage across the chat.
- [ ] `messages.countTokens()` to price a request *before* sending it.

## TODO — UI / UX (next session)

### Raw markdown is visible for the whole stream

The committed history renders through `react-markdown`, but the in-flight
answer is still plain text, so the user watches `## headings` and `**bold**`
scroll by and then *snap* into formatting once the stream commits. Worst of
both: raw syntax the whole time, plus a layout jump at the end.

That plain-text choice was a deliberate perf trade-off — `react-markdown` has
no internal caching and reparses from scratch on every render. Options:

- [ ] **Render the streaming reply as markdown too.** ~1 parse per chunk
      (~100 for a long answer). Simplest, probably fine. Half-finished syntax
      will flicker (an unclosed ``` briefly renders as plain text) — that
      happens on chatgpt.com and claude.ai too, it isn't a bug to chase.
- [ ] Or throttle: only re-parse every ~100ms instead of every chunk.
- [ ] Measure before optimizing — 100 parses may just be fine.

### Styling

- [ ] `@tailwindcss/typography` — installed nothing yet. Preflight zeroes out
      heading sizes and list bullets, so markdown renders structurally correct
      but visually flat. Add `@plugin "@tailwindcss/typography";` to
      `globals.css` and wrap content in `prose dark:prose-invert`.
- [ ] Syntax highlighting for code blocks (`rehype-highlight`)
- [ ] Chat layout — user/assistant bubbles, not `<strong>role:</strong>`
- [ ] `min-h` on the answer area so the page doesn't jump as text streams in
- [ ] Auto-scroll to the bottom while streaming
- [ ] Remove the `console.log` in `Message` once memo is verified

Smoothness note: the burst-y arrival is the model's real rhythm, not a bug.
A true typewriter effect needs a client-side render queue that releases
characters at a fixed rate — pure UI sugar, unrelated to the stream itself.
