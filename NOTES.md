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

### Open question — answered

Error status codes: once the first byte is sent the status is locked at 200.
Anything that can fail must be validated **before** `.stream()` is called.

Except `.stream()` is lazy — the request only fires on the first iteration,
which is already inside `start()`, so "before" doesn't exist for upstream
errors. See *Errors have to travel in-band* below.

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

## UI / UX — what shipped

### The streaming reply and the committed one must render identically

The in-flight answer used to be plain text while history went through
`react-markdown`, so raw `##` scrolled past for the whole stream and then
snapped into formatting. The snap was the worse half: the two paths emitted
different DOM, so the handoff recomputed heights and shifted the page — CLS,
one of the Core Web Vitals.

Fix: route both through the same `Message` component.

```jsx
{streaming && (
  <Message streaming message={{ role: "assistant", content: reply }} />
)}
```

Nothing changes on screen at commit because nothing changes in the DOM — only
where the data came from. React 18's automatic batching covers the three
`setState` calls in `useChat`'s `finally`, so there is no frame showing the
answer twice or an orphaned cursor. (React 17 batched only inside event
handlers; code after an `await` was not batched, and this would have flickered.)

The feared cost — `react-markdown` reparsing on every chunk, ~100 parses for a
long answer — is not measurable. Don't throttle until it is.

### The cursor has to be a pseudo-element

markdown emits block-level tags. A block and an inline `<span>` cannot share a
line, so a real cursor element drops to the next row. `::after` lives inside
the block's own inline formatting context and sits flush against the last
character.

```css
.streaming > :last-child::after,
.streaming:empty::after {
  content: "";
  display: inline-block; /* an inline box ignores width/height */
  width: 0.5em;
  height: 1em; /* em tracks font-size, so it grows inside a heading */
  margin-left: 0.15em;
  vertical-align: text-bottom;
  background: currentColor; /* follows the text color into dark mode */
  animation: cursor-blink 1s steps(2, start) infinite;
}
```

`steps()` snaps between states; default easing reads as a breathing glow, not a
cursor. `:empty` covers the gap before the first token arrives.

### `prose` is for HTML you don't control

Preflight zeroes native tag styles — right for hand-written components, wrong
for `react-markdown` output, whose tags can't be given a class. The typography
plugin styles them from the container: `.prose :where(h2):not(...)`, targeting
*descendants*, so `prose` goes on the wrapper, never on the tag itself.

Tailwind v4 registers it in CSS, not a config file:

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";
```

Three defaults had to be overridden for a chat column:

- Heading scale — `h1` at 2.2em anchors an article page; in a 700px column it
  shouts. Compressed toward body size, weight carries the hierarchy.
- Inline code inside a heading — the plugin drops it to 0.875em and leaves the
  weight alone: two fonts, two sizes, two weights in one line.
- Literal backticks around inline code (`code::before` / `::after`) — readable
  in print, noise in a chat.

Override with `:is()`, not `:where()`. The plugin uses `:where()` deliberately
so its rules have zero specificity and lose to anything. `:is()` takes the
highest specificity inside it, so `.prose :is(h1, h2)` is (0,1,1) and beats
`.prose :where(h1)` at (0,1,0). Matching `:where()` would leave the winner
decided by stylesheet order — fragile.

### Colors as tokens, dark mode as reassignment

Every color lives in one `:root` block; `page.tsx` holds no literal color.
Swapping the accent from terracotta to navy touched `globals.css` alone.

Dark mode redefines the same variables and repeats no rule — and does **not**
reuse the accent: `#0e21a0` on a dark ground is ~1.3:1, invisible. A dark
palette lightens its saturated colors; it doesn't just swap fg and bg.

Neutrals are tinted toward the accent's hue (`#16182b`, not `#171717`). Per
color the difference is invisible; across the set it's what reads as designed.

Because the variables own dark mode, `dark:prose-invert` had to go — it would
be a second, conflicting source of truth.

### `justify-between` only works when height is independent of content

The composer was pushed to the bottom of `main` with `justify-between`, but
`main` grows with the messages, so after 20 turns the input sat 5000px down the
document. `flex-1` guarantees *at least* the viewport; it doesn't cap.

Scrolling belongs to the list, not the page:

```
main            h-dvh flex flex-col          <- height pinned to the viewport
├─ div          flex-1 overflow-y-auto       <- only this scrolls
└─ div          composer, normal flow        <- lands at the bottom for free
```

`h-dvh`, not `h-screen`: `100vh` sits under the mobile address bar.

`position: fixed` is the wrong repair — it leaves the flow, so the list doesn't
know 140px is floating over it and the last message hides underneath.

### Auto-scroll has to yield to the user

Unconditional `scrollIntoView` yanks the reader back to the bottom on the next
token whenever they scroll up to re-read. Only follow if they were already
near the bottom:

```ts
// a value ref, not a DOM ref: "does the user still want to follow along".
// useState would re-render — and re-parse markdown — on every scroll frame.
const stickToBottom = useRef(true);

const handleScroll = () => {
  const el = scrollRef.current;
  if (!el) return;
  const { scrollTop, scrollHeight, clientHeight } = el;
  // leeway absorbs subpixel rounding and scroll momentum; a strict === is flaky
  stickToBottom.current = scrollHeight - scrollTop - clientHeight < 100;
};

useEffect(() => {
  if (stickToBottom.current) bottomRef.current?.scrollIntoView();
}, [reply, messages]);
```

`scrollHeight - scrollTop - clientHeight` is how much is left below. The
sentinel — an empty `<div>` marking the end — is declarative: name the target,
let the browser compute the number. (Same pattern as an `IntersectionObserver`
sentinel for infinite scroll.)

`overscroll-behavior: contain` stops scroll chaining at the boundary, which
also blocks mobile pull-to-refresh from wiping the conversation.

Never `behavior: "smooth"` while streaming — dozens of animations per second
interrupt each other and never catch up.

### An effect's deps decide *when*, not *whether*

Auto-grow initially lived in the scroll effect, keyed on `[reply, messages]`.
Typing changes neither, so it only ran when a reply arrived. Correct code that
never runs at the right time. One effect, one concern, one dep list:

```ts
// scrollHeight never reports less than the current height, so the box could
// only ever grow without the reset-to-auto first. The pair is load-bearing.
useEffect(() => {
  const el = textareaRef.current;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}, [input]);
```

`field-sizing: content` will replace both lines once Safari ships it.

### Enter during an IME preedit isn't yours

Typing `nihao` opens a candidate list; Enter there commits the raw pinyin. The
`keydown` still reaches the handler, so without a guard the message is sent —
carrying the *previous* value, since React state hasn't updated.

```ts
const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  // Enter during an IME preedit commits the raw pinyin to the field — the key
  // never meant "send". React state also still holds the previous value here,
  // so submitting would post the message one keystroke stale.
  if (e.nativeEvent.isComposing) return;

  // Shift+Enter falls through to the textarea's own newline handling
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault(); // otherwise the newline is inserted before we clear
    submit();
  }
};
```

Space selects a candidate, not Enter — the guard is about the preedit state
being open, not about the selection key.

`keyCode === 229` is the pre-`isComposing` version of this check; recognize it
in old code, don't write it. Safari used to fire `keydown` *after*
`compositionend`, so `isComposing` was already false — the reason older
libraries track `onCompositionStart`/`End` in a ref instead. Fixed now; if a
bug is Safari-only, suspect event ordering first.

Also: `disabled` guards the *Send* half only. Disabling the button while
streaming kills Stop exactly when it's most wanted.

### Scrollbars: transparent, not hidden

`display: none` removes the only cue for how far through a long answer you are.
Transparent at rest, visible on hover keeps the information and drops the
noise. `scrollbar-gutter: stable` reserves the track so content doesn't shift
sideways the moment a reply grows tall enough to overflow.

`scrollbar-width` / `scrollbar-color` are standard; `::-webkit-scrollbar` is
still needed for older Safari. One of the few places vendor syntax survives.

---

## Model migration: removed parameters, not missing models

Switching `claude-sonnet-4-6` -> `claude-sonnet-5` returned:

```
400 invalid_request_error: `temperature` is deprecated for this model.
```

The Claude 5 family rejects all sampling parameters — `temperature`, `top_p`,
`top_k`. Adaptive thinking decides depth itself and hand-tuned sampling fights
it. Shape output through the system prompt, `output_config.effort`
(`low`|`medium`|`high`|`xhigh`|`max`), or structured outputs instead.

Removed in the same generation: `budget_tokens` (superseded by `effort`) and
assistant prefill.

**The upgrade failure mode is a stale parameter, not a missing model.** Read
the migration notes before changing a model id.

---

## Errors have to travel in-band

`client.messages.stream()` is lazy: the HTTP request fires on the first
iteration, which happens inside `ReadableStream.start()` — after the 200
headers have shipped. `controller.error()` there severs the connection, and the
browser sees a bare `TypeError: Failed to fetch`. A bad parameter, a rate
limit, and an exhausted balance all surfaced as one generic message.

The status code is spent once. The stream can carry any number of typed events.

```ts
} catch (err) {
  // controller.error() severs the connection: the browser sees a bare
  // network failure with no status and no body. Send the reason as a
  // frame and close cleanly instead.
  console.error("chat stream failed:", err);
  controller.enqueue(frame({ type: "error", message: apiErrorMessage(err) }));
  controller.close();
}
```

The client `throw`s on receipt so the existing abort-vs-error branch and the
commit path in `finally` handle it unchanged — reuse the error path, don't open
a second one.

`APIError` carries two different things: `err.message` is the status plus the
whole raw JSON body (for logs), and `err.error` is the parsed payload whose
`.error.message` is the human sentence (for users).

```ts
// err.message on an APIError is the status plus the whole raw JSON body. The
// human-readable sentence lives in the parsed payload; dig it out.
const apiErrorMessage = (err: unknown) => {
  if (!(err instanceof Anthropic.APIError)) return "Upstream request failed.";
  const body = err.error as { error?: { message?: string } } | undefined;
  return `${err.status}: ${body?.error?.message ?? err.message}`;
};
```

**This is what a frame protocol buys over a bare text stream.**

---

## Tool use

### The model never executes anything

It stops and says what it wants called. One exchange is **two API requests**:

```
1. you -> Claude:  messages + tools
2. Claude -> you:  stop_reason: "tool_use"
                   content: [{ type: "tool_use", id: "toolu_01A",
                               name: "get_weather", input: { city: "Tokyo" } }]
3. you:            run get_weather("Tokyo") yourself
4. you -> Claude:  history
                   + { role: "assistant", content: <step 2's content, whole> }
                   + { role: "user", content: [{ type: "tool_result",
                       tool_use_id: "toolu_01A", content: "..." }] }
5. Claude -> you:  "Tokyo is 18C and sunny."  stop_reason: "end_turn"
```

An agent is this loop, automated until `stop_reason` stops being `"tool_use"`.

Three rules that produce a 400 when broken:

- `tool_use_id` must match exactly — one turn can carry several calls.
- `tool_result` goes in a **user** message. Counterintuitive: the developer
  produced it, but anything not generated by the model is user input.
- The assistant message replays the **whole `content` array**, not just text.
  Drop the `tool_use` block and the `tool_result` references a call that,
  as far as the API can see, never happened.

### The route becomes a loop

`stream` stops being a module-level constant and becomes a per-round local; a
`let currentStream` outside the loop is what `cancel()` can still reach.

```ts
const history: Anthropic.MessageCreateParams["messages"] = [...messages];

for (let round = 0; round < MAX_ROUNDS; round++) {
  const stream = client.messages.stream({ ...params, tools: TOOLS, messages: history });
  currentStream = stream;

  for await (const event of stream) { /* forward text_delta */ }
  const final = await stream.finalMessage();

  if (final.stop_reason !== "tool_use") {
    // the only successful exit
    controller.enqueue(frame({ type: "usage", ... }));
    controller.close();
    return;
  }

  const calls = final.content.filter(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );

  const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
    calls.map(async (call) => ({
      type: "tool_result" as const,
      tool_use_id: call.id,
      content: await runTool(call.name, call.input),
    }))
  );

  history.push({ role: "assistant", content: final.content });
  history.push({ role: "user", content: results });  // all results, ONE message
}
```

Every round takes exactly one of two exits: `return` (answer) or fall through
to the next iteration (tool request). Splitting those two paths across the
inside and outside of the loop is what made the first attempt unreadable.

`controller.close()` may run once per request. It appears in three mutually
exclusive places: the terminal branch, the round-limit fallback, and `catch`.

`Promise.all`, not sequential `await` — the model may ask for two cities at
once and serial execution doubles the wait for nothing.

`MAX_ROUNDS` is **not optional**. A model that keeps calling tools without
converging bills forever, and nothing else stops it. Falling out of the loop
needs its own error frame and `close()`, or the stream hangs until timeout.

### Usage has to accumulate

`final.usage` covers the last request only. Without carrying totals across
rounds the displayed cost silently under-reports — the tool rounds vanish.

```ts
const totals = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0
};
// per round:
totals.input_tokens += final.usage.input_tokens;
totals.output_tokens += final.usage.output_tokens;
totals.cache_creation_input_tokens += final.usage.cache_creation_input_tokens ?? 0;
totals.cache_read_input_tokens += final.usage.cache_read_input_tokens ?? 0;
// on the terminal branch:
usage: { ...final.usage, ...totals }   // spread order matters
```

### `TOOLS` belongs at module scope

Tools render at the very front of the prompt — before `system`, before
`messages`. One changed byte invalidates the cache for everything behind it.
Same rule as `SYSTEM_PROMPT`.

`description` is not a comment; it is the model's entire spec for when to call
the tool. "Get the weather" is not enough — state what it does, when to reach
for it, and the argument format. Write it in English: it is prompt text.

### Event anatomy, observed

Asking for two cities at once produced:

```
message_start
content_block_start  index 0                      <- text
content_block_delta  index 0  x2
content_block_stop   index 0
content_block_start  index 1  tool_use + id       <- first call
content_block_delta  index 1  x3
content_block_stop   index 1
content_block_start  index 2  tool_use + id       <- second call, same message
content_block_delta  index 2  x3
content_block_stop   index 2
message_delta        stop_reason: "tool_use"
message_stop
--- round 2 ---
message_start
content_block_start  index 0                      <- text only
content_block_delta  index 0  x3
content_block_stop   index 0
message_delta
message_stop
```

- `index` is the position in `content[]`. Round 1 held three blocks: a text
  preamble plus two parallel `tool_use` calls in **one** message.
- The deltas differ by block: `text_delta` at index 0, `input_json_delta` at
  1 and 2 — **tool arguments stream as JSON fragments** (`{"city`, `": "Tok`,
  `yo"}`). The existing `event.delta.type === "text_delta"` check is what keeps
  half-built JSON out of the UI.
- Arguments are therefore unreadable mid-stream. `finalMessage()` reassembles
  the fragments; that's what it's for.
- `message_delta` carries `stop_reason` and cumulative output tokens;
  `message_stop` is a bare terminator.

Round 1's text preamble and round 2's answer both reach the same client buffer
and concatenate — correct, and what claude.ai does. What's missing is a visual
marker between them, which is the job of the `tool_use` frame.

### Server-local history is lost on the next turn

The loop's `tool_use` / `tool_result` messages live in a request-scoped array.
The client only ever received text, so its `messages` has no record of them —
next turn, Claude can't answer "which city did you look up?"

That is the price of a stateless server: **context produced inside one request
is gone unless it's handed to the client.** Fixing it means new frames carrying
the authoritative `content` block arrays, which splits the protocol in two:

| | display frames | commit frames |
|---|---|---|
| granularity | one per token | one per round |
| payload | text fragment | full `ContentBlock[]` |
| consumer | `setReply()` | `setMessages()` |

`ChatMessage` already extends `Anthropic.MessageParam`, whose `content` is
`string | ContentBlockParam[]`, and `renderContent` already branches on the
array case. Mostly filling in a TODO, not a rewrite.

---

## TODO

### Tool use

- [ ] Render the `tool_use` frame in the UI — the call is invisible today, and
      the gap between the preamble and the answer is a silent multi-second wait.
- [ ] Commit frames so tool blocks survive into the next turn (above).
- [ ] A second tool, to see how the model picks between them.
- [ ] A tool that can fail — return the error as a `tool_result` and let the
      model recover, rather than throwing and killing the stream.

### Caching

- [ ] Verify caching still works after *any* change to prompt assembly. The
      costly failure mode is silent: requests keep succeeding, the bill is
      just higher. An assertion that a second identical request has
      `cache_read_input_tokens > 0` is worth more than a one-time eyeball.
      Tool definitions now sit in front of the prefix — one more thing that
      invalidates everything when edited.
- [ ] Session total, not just per-message — sum usage across the chat.
- [ ] `messages.countTokens()` to price a request *before* sending it.

### Before deploying publicly

- [ ] Spend cap in the Anthropic Console. Last line of defense — a public demo
      spends the owner's money on every visitor.
- [ ] Per-IP rate limiting.
- [ ] Consider `output_config: { effort: "low" }` and a smaller `max_tokens`.

### Polish

- [ ] Syntax highlighting for code blocks (`rehype-highlight`).
- [ ] A "new conversation" control.
- [ ] `key={i}` in the message list — safe while the array is append-only,
      still not a habit worth keeping.
