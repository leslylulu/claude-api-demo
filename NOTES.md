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

## ReadableStream

Without a stream the server waits for the whole answer, then sends it. With
one, each word leaves the moment Claude produces it.

```tsx
const encoder = new TextEncoder(). // they carry raw bytes.
// TextEncoder is translator from string to bytes,
// TextDecoder is translator from bytes to string
```

### Mental model: a faucet, not a bucket

A normal response is a bucket — fill it completely, then hand it over.
A stream is a tap — open it, and water comes out while the other side drinks.

### What format is it?

**It has no format.** It's a pipe carrying `Uint8Array` chunks. Whether those
bytes mean plain text, SSE, or JSON Lines is a contract with the consumer, and
that contract is the `Content-Type` header.

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

`close()` and `error()` are **mutually exclusive** terminal states — calling
the second one throws. Hence `close()` inside the `try`, not a `finally`.

### Key point: it's PULL-based (backpressure)

The **consumer** sets the pace. `pull` fires only when the internal queue drops
below its high water mark, so a slow reader throttles the producer — which is
what stops a fast producer from OOM-ing the server.

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

`route.ts` puts everything in `start` (eager) and skips `pull` — fine when
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

LLM chat is one-way, so **WebSocket is overkill**. Vercel AI SDK
(`streamText()` + `useChat()`) wraps all of this, at the cost of one more
abstraction layer.

## chat/route.ts

### `.stream()` vs `.create()`

Same parameters, different return. `.create()` → `Promise<Message>`, you wait
for the whole answer. `.stream()` → a `MessageStream` you iterate as tokens
arrive, **not** awaited on the call itself.

### Why the body is bytes, not a string

`new Response(body)` also accepts a string — but a string has to be
**complete** before it ships, which defeats the point. `ReadableStream` carries
bytes, so `TextEncoder` converts `string` → `Uint8Array` per chunk.

### Filtering the events

`for await` iterates events the SDK parsed out of Anthropic's SSE. Only
`content_block_delta` + `text_delta` is real text; `message_start`,
`content_block_stop`, `message_delta` and friends are metadata.

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

Once the first byte ships the status is locked at 200, so anything that can
fail must be validated before `.stream()`. Except `.stream()` is lazy: the
request fires on the first iteration, already inside `start()`. "Before"
doesn't exist for upstream errors — see *Errors have to travel in-band*.

## page.tsx

### `streaming`, not `loading`

The first token arrives in ~200ms, so "waiting" barely exists as a state. The
meaningful one is "still receiving", which is also what lets the button double
as Stop.

### `useRef` for the AbortController, not `useState`

A mutable handle only ever read inside callbacks; state would re-render for
nothing.

**Does the UI need to update when this value changes?** No → `useRef`.
Yes → `useState`.

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

Without the guard, Stop wipes the text already on screen. `return` inside
`catch` still runs `finally`, so cleanup is unaffected.

### Check `response.ok` before reading

Errors thrown before the stream opens are normal status codes; after, the
status is locked at 200. Skip this check and a 400 body streams onto the page
as if it were an answer.

### Decode once per chunk

```ts
const chunk = decoder.decode(value, { stream: true });
result += chunk;
setReply(result);
```

`TextDecoder` is **stateful** — it buffers incomplete multi-byte sequences
between calls, so decoding the same bytes twice (an extra `console.log`)
corrupts characters.

The local `result` also sidesteps the stale-closure trap: `reply` is frozen for
the whole function call, so `setReply(reply + chunk)` never advances. The
alternative is `setReply(prev => prev + chunk)`.

## Stateless vs stateful chat

The Messages API is **stateless** — nothing is remembered between calls, so
every request resends the whole history. Hence a `messages[]` array posted in
full each turn.

claude.ai is **stateful**: requests go to `/chat_conversations/{uuid}/...`, the
conversation lives in a database, the client sends only the new message.

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

These need different reactions — a blip should *not* kill the generation — so
intent gets its own request. `completion_request_id` says *which* generation,
since several can be in flight across devices, and the server still has to
persist the partial answer so every device agrees.

### Why this app doesn't need one

Here the connection **is** the only source of truth:

```
Stop → fetch abort → connection drops → route.ts cancel() → stream.abort()
```

No session to keep in sync, so the implicit signal is enough. A stop endpoint
would first require server-side conversation storage — solving a problem this
app doesn't have.

**The trade-off:** a blip and a deliberate stop are indistinguishable. Wi-Fi
drops, generation dies, and the message is labelled "stopped by you" anyway.
Statelessness buys simplicity and pays with lost intent.

### Consecutive user messages

Stopping before the first token stores no assistant message (empty `content`
is rejected), so history can hold two `user` messages in a row. The API merges
them into one turn.

claude.ai instead stores the partial answer however short and marks it stopped.
Matching that means dropping the trim guard and storing placeholder text, which
leaks into the next turn's context. No clean answer either way.

## System prompt

Sets context for the **entire** conversation, not one message: role, output
format, scope, tone, and any standing facts (budget, dates, domain).

Be specific; say what **to do** rather than what not to do; use structure —
bullets and tables are easier to follow than prose.

## Prompt caching + token counting

### The wire format had to change first

Usage totals only exist *after* the last token, and headers lock once the first
byte ships — plain text can carry the answer and nothing else.

Fix: **NDJSON** (`application/x-ndjson`), one JSON object per line.
`JSON.stringify` escapes newlines inside strings, so a raw `\n` is
unambiguously a separator and can never appear inside a frame.

```ts
type Frame =
	| { type: "text"; text: string }
	| { type: "usage"; model: string; stop_reason: ...; usage: Anthropic.Usage };

const frame = (f: Frame) => encoder.encode(JSON.stringify(f) + "\n");
```

This is the SSE row of the table above minus the `event:` / `data:` ceremony
and auto-reconnect. Take real SSE when you want those.

### Framing means the client needs a buffer

The network hands you arbitrary chunks — three lines, or half of one.
**Only the text after the last `\n` is incomplete:**

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

Two buffers stacked: `TextDecoder` holds partial *bytes*, this holds partial
*lines*. Skip the second and you get `Unexpected end of JSON input` — only on
long answers, never in a short local test.

### One line enables caching

```ts
const stream = client.messages.stream({
	model: MODEL,
	cache_control: { type: "ephemeral" }, // top-level = automatic
	system: SYSTEM_PROMPT,
	messages,
});
```

Top-level `cache_control` puts one breakpoint on the last cacheable block —
always the newest turn as the array grows. Each request reads the whole prior
conversation and writes only the delta. The manual equivalent is `cache_control`
on `messages.at(-1)`; automatic needs no bookkeeping and is the right default
for multi-turn chat.

Go explicit when the prompt **ends** in per-request content (retrieved rows, a
one-off question): the automatic breakpoint lands after that unique tail, so
every request pays the write premium on bytes nobody reads back. Put the marker
at the end of the *shared* part instead.

### It's a prefix match — that's the whole model

Render order is `tools` → `system` → `messages`, and one changed byte
invalidates everything after it. The silent killers all live at the front:

| Anti-pattern | Why it kills the cache |
| --- | --- |
| `Date.now()` / a UUID in the system prompt | prefix differs every request |
| `if (flag) system += ...` | each flag combo is a distinct prefix |
| `JSON.stringify` over an unordered object | bytes differ run to run |
| adding/reordering a tool mid-conversation | tools render at position 0 |
| switching models mid-conversation | caches are model-scoped |

Hence `SYSTEM_PROMPT` as a module-scope const, not a per-request template.
Inject dynamic content *after* the history, never in `system`.

### The three token fields are disjoint

`input_tokens` is the **uncached remainder only**. Real prompt size is the sum:

```
promptTokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens
```

An agent running an hour at `input_tokens: 4000` isn't a small prompt, it's a
well-cached one. Reading that field alone is the classic misread.

### Measured on this app

Two requests sharing a ~3.6K-token prefix:

| | `input` | `cache_creation` | `cache_read` |
| --- | ---: | ---: | ---: |
| cold | 3 | 3,643 | 0 |
| warm | 3 | 15 | 3,643 |

Row two is the **healthy-loop signature**: read everything so far, write only
the delta. Effective input on turn 2 is `3 + 3643×0.1 + 15×1.25 ≈ 386` billed
tokens instead of 3,661 — ~89% off.

`cache_creation` near full conversation size on *every* request means the
prefix is being rewritten upstream. `cache_read` flat zero → anti-pattern
table.

### Economics

Reads cost **0.1×** base input; writes **1.25×** (5-min TTL) or **2×** (1-hour).
A 5-minute entry breaks even on the second request (1.25 + 0.1 = 1.35 vs 2.0
uncached); a 1-hour entry needs a third.

A read **refreshes the timer for free**, measured from the request's start. So
continuous traffic keeps a 5-minute entry alive forever and the 1-hour TTL buys
nothing but a doubled write price. It only pays in the 5–60 minute gap — a user
who replies after 20 minutes.

### The gotcha: minimum cacheable prefix

Below the minimum, caching **silently does nothing** — no error, just
`cache_creation_input_tokens: 0`. The minimum is *not* monotonic across
generations:

| Model | Minimum |
| --- | ---: |
| Opus 5 | 512 |
| Sonnet 5, **Sonnet 4.6** | 1,024 |
| Opus 4.7 | 2,048 |
| Opus 4.6, Haiku 4.5 | 4,096 |

`SYSTEM_PROMPT` is ~80 tokens, so **caching it alone would never have done
anything** — the win exists only because the breakpoint sits on the growing
conversation. Short chats still show all zeros; correct, not a bug.

## UI / UX — what shipped

### The streaming reply and the committed one must render identically

The in-flight answer was plain text while history went through
`react-markdown`, so raw `##` scrolled past and then snapped into formatting.
The snap was the worse half: two paths emitting different DOM, so the handoff
recomputed heights and shifted the page — CLS, one of the Core Web Vitals.

Fix: route both through the same `Message` component.

```jsx
{streaming && (
  <Message streaming message={{ role: "assistant", content: reply }} />
)}
```

Nothing changes on screen at commit because nothing changes in the DOM — only
where the data came from. React 18's automatic batching covers the three
`setState` calls in `finally`, so no frame shows the answer twice or an
orphaned cursor. (React 17 batched only inside event handlers; code after an
`await` wasn't, and this would have flickered.)

The feared cost — ~100 markdown reparses per answer — isn't measurable. Don't
throttle until it is.

### The cursor has to be a pseudo-element

markdown emits block-level tags, and a block and an inline `<span>` can't share
a line — a real cursor element drops to the next row. `::after` lives inside the
block's own inline formatting context, flush against the last character.

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
for `react-markdown` output, whose tags can't be given a class. The plugin
styles them from the container: `.prose :where(h2):not(...)` targets
*descendants*, so `prose` goes on the wrapper, never on the tag.

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
so its rules carry zero specificity and lose to anything. `:is()` takes the
highest specificity inside it: `.prose :is(h1, h2)` is (0,1,1) and beats
`.prose :where(h1)` at (0,1,0). Matching `:where()` leaves the winner to
stylesheet order — fragile.

### Colors as tokens, dark mode as reassignment

Every color lives in one `:root` block; `page.tsx` holds no literal color.
Swapping the accent from terracotta to navy touched `globals.css` alone.

Dark mode redefines the same variables and repeats no rule — and does **not**
reuse the accent: `#0e21a0` on a dark ground is ~1.3:1, invisible. A dark
palette lightens its saturated colors; it doesn't just swap fg and bg.

Neutrals are tinted toward the accent's hue (`#16182b`, not `#171717`) — per
color invisible, across the set it's what reads as designed.

Since the variables own dark mode, `dark:prose-invert` had to go: a second,
conflicting source of truth.

### `justify-between` only works when height is independent of content

`justify-between` pushed the composer to the bottom of `main` — but `main`
grows with the messages, so after 20 turns the input sat 5000px down the
document. `flex-1` guarantees *at least* the viewport; it doesn't cap.

Scrolling belongs to the list, not the page:

```
main            h-dvh flex flex-col          <- height pinned to the viewport
├─ div          flex-1 overflow-y-auto       <- only this scrolls
└─ div          composer, normal flow        <- lands at the bottom for free
```

`h-dvh`, not `h-screen`: `100vh` sits under the mobile address bar.

`position: fixed` is the wrong repair — out of flow means the list doesn't know
140px floats over it, and the last message hides underneath.

### Auto-scroll has to yield to the user

Unconditional `scrollIntoView` yanks the reader back on the next token whenever
they scroll up to re-read. Only follow if they were already near the bottom:

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
also blocks mobile pull-to-refresh from wiping the conversation. Never
`behavior: "smooth"` while streaming — dozens of animations a second interrupt
each other and never catch up.

### An effect's deps decide *when*, not *whether*

Auto-grow first lived in the scroll effect, keyed on `[reply, messages]`.
Typing changes neither, so it only ran when a reply arrived — correct code that
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
`keydown` still reaches the handler, so without a guard the message is sent,
carrying the *previous* value — React state hasn't updated yet.

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

Space selects a candidate, not Enter — the guard is about the preedit being
open, not about the selection key.

`keyCode === 229` is the pre-`isComposing` version: recognize it in old code,
don't write it. Safari used to fire `keydown` *after* `compositionend`, leaving
`isComposing` false — why older libraries track `onCompositionStart`/`End` in a
ref. Fixed now; if a bug is Safari-only, suspect event ordering first.

`disabled` guards the *Send* half only. Disabling while streaming kills Stop
exactly when it's most wanted.

### Scrollbars: transparent, not hidden

`display: none` removes the only cue for how far through a long answer you are.
Transparent at rest, visible on hover keeps the information and drops the noise.
`scrollbar-gutter: stable` reserves the track so content doesn't shift sideways
when a reply first overflows.

`scrollbar-width` / `scrollbar-color` are standard; `::-webkit-scrollbar` is
still needed for older Safari — one of the few places vendor syntax survives.

---

## Model migration: removed parameters, not missing models

Switching `claude-sonnet-4-6` -> `claude-sonnet-5` returned:

```
400 invalid_request_error: `temperature` is deprecated for this model.
```

The Claude 5 family rejects all sampling parameters — `temperature`, `top_p`,
`top_k`. Adaptive thinking decides depth itself and hand-tuned sampling fights
it. Shape output through the system prompt, `output_config.effort`
(`low`|`medium`|`high`|`xhigh`|`max`), or structured outputs.

Also removed that generation: `budget_tokens` (superseded by `effort`) and
assistant prefill.

**The upgrade failure mode is a stale parameter, not a missing model.**

---

## Errors have to travel in-band

`client.messages.stream()` is lazy: the request fires on the first iteration,
inside `ReadableStream.start()`, after the 200 headers have shipped.
`controller.error()` there severs the connection and the browser sees a bare
`TypeError: Failed to fetch` — a bad parameter, a rate limit, and an exhausted
balance all arriving as one generic message.

The status code is spent once. The stream can carry any number of typed
events.

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

`APIError` carries two things: `err.message` is the status plus the raw JSON
body (for logs); `err.error.error.message` is the human sentence (for users).

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

It stops and names what it wants called. One exchange is **two API requests**:

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

An agent is this loop, run until `stop_reason` stops being `"tool_use"`.

Three rules that 400 when broken:

- `tool_use_id` must match exactly — one turn can carry several calls.
- `tool_result` goes in a **user** message. Counterintuitive: the developer
  produced it, but anything not generated by the model is user input.
- The assistant message replays the **whole `content` array**, not just text.
  Drop the `tool_use` block and the `tool_result` references a call that,
  as far as the API can see, never happened.

### The route becomes a loop

`stream` becomes a per-round local; a `let currentStream` outside the loop is
what `cancel()` can still reach.

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

Every round takes one of two exits: `return` (answer) or fall through to the
next iteration (tool request). Splitting those paths across the inside and
outside of the loop is what made the first attempt unreadable.

`controller.close()` runs once per request, from three mutually exclusive
places: the terminal branch, the round-limit fallback, and `catch`.

`Promise.all`, not sequential `await` — the model may ask for two cities at
once and serial execution doubles the wait for nothing.

`MAX_ROUNDS` is **not optional**: a model that keeps calling tools without
converging bills forever and nothing else stops it. Falling out of the loop
needs its own error frame and `close()`, or the stream hangs until timeout.

### Usage has to accumulate

`final.usage` covers the last request only; without totals the displayed cost
silently under-reports, the tool rounds vanishing entirely.

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
`messages` — so one changed byte invalidates everything behind it. Same rule as
`SYSTEM_PROMPT`.

`description` is not a comment; it is the model's entire spec for when to call
the tool. "Get the weather" is not enough — state what it does, when to reach
for it, and the argument format. Write it in English: it's prompt text.

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
The client only received text, so its `messages` has no record — next turn,
Claude can't answer "which city did you look up?"

The price of a stateless server: **context produced inside one request is gone
unless handed to the client.** Fixing it means new frames carrying the
authoritative `content` block arrays, which splits the protocol in two:

| | display frames | commit frames |
|---|---|---|
| granularity | one per token | one per round |
| payload | text fragment | full `ContentBlock[]` |
| consumer | `setReply()` | `setMessages()` |

`ChatMessage` already extends `Anthropic.MessageParam`, whose `content` is
`string | ContentBlockParam[]`, and `renderContent` already branches on the
array case — filling in a TODO, not a rewrite.

---

## Comments, extracted

Every explanatory comment that used to live in the source, kept with the code it
was attached to. The files now carry keyword markers only — the reasoning is here.

### `app/api/chat/route.ts`

**`MAX_ROUNDS` — the loop needs a ceiling**

```ts
const MODEL = "claude-sonnet-5";
const MAX_ROUNDS = 10; // tool rounds cap
```

Max turns of conversation before we give up and close the stream. A model that
keeps asking for tools and never converges would otherwise loop forever on the
server's money.

**`SYSTEM_PROMPT` at module scope**

```ts
const SYSTEM_PROMPT = `You are a helpful assistant in a chat app.
- Answer in the same language the user writes in.
- Use markdown for structure: headings, lists, tables, code blocks.
- Be concise. Prefer three short paragraphs over ten.
- If you are unsure, say so instead of guessing.`;
```

Kept at module scope so the string stays byte-identical across requests — a
stable prefix is what prompt caching needs. Never interpolate a date, a user id,
or a feature flag in here: it sits at the front of the prefix, so one changed
byte makes every cached turn behind it uncacheable.

**`Frame` — our wire protocol, not the API's**

```ts
type Frame =
	| { type: "text"; text: string }
	| { type: "turn", content: Anthropic.ContentBlock[] }
	| {
			type: "usage";
			model: string;
			stop_reason: Anthropic.Message["stop_reason"];
			usage: Anthropic.Usage;
		}
	| { type: "error"; message: string }
	| { type: "tool_result"; content: Anthropic.ToolResultBlockParam[] }
```

The API's own block enum is wider — `thinking`, `tool_use`, `tool_result`,
`text`, `usage`, `image`, `citation`, plus event types like `start`, `error`,
`metadata`. This union is only what *this app* puts on the wire.

**`apiErrorMessage` — dig the sentence out**

```ts
const apiErrorMessage = (err: unknown) => {
	if (!(err instanceof Anthropic.APIError)) return "Upstream request failed.";
	const body = err.error as { error?: { message?: string } } | undefined;
	return `${err.status}: ${body?.error?.message ?? err.message}`;
};
```

`err.message` on an `APIError` is the status plus the whole raw JSON body. The
human-readable sentence lives in the parsed payload; dig it out.

**`frame()` — NDJSON in two steps**

```ts
const encoder = new TextEncoder();
const frame = (f: Frame) => encoder.encode(JSON.stringify(f) + "\n");
```

- obj → string + `\n` : `'{"type":"text","text":"hi"}\n'`
- string → `Uint8Array`: `Uint8Array(31) [123, 34, 116, 121, 112, 101, ... , 10]`

**`totals` — usage has to survive the loop**

```ts
const totals = {
	input_tokens: 0,
	output_tokens: 0,
	cache_creation_input_tokens: 0,
	cache_read_input_tokens: 0
};
```

One turn can now cost several requests. `final.usage` covers only the last of
them, so the numbers have to be carried across rounds.

**Streaming the deltas**

```ts
const stream = client.messages.stream({ model: MODEL, /* ... */ messages: history });
currentStream = stream;

for await (const event of stream) {
	if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
		controller.enqueue(frame({ type: "text", text: event.delta.text }));
	}
}

const final = await stream.finalMessage();
```

Event order per request: `message_start`, `content_block_start`,
`content_block_delta` × n, `content_block_stop`, `message_delta`,
`message_stop`.

If you want results earlier, `.on('contentBlock', (block) => {})` hands you each
block as soon as it arrives — but the final message is only available after the
stream is done.

**`stop_reason` decides whether to loop**

```ts
if (final.stop_reason !== "tool_use") {
	controller.enqueue(frame({
		type: "usage",
		model: final.model,
		stop_reason: final.stop_reason,
		usage: { ...final.usage, ...totals }
	}));

	controller.close();
	return; // only successful exit
}
```

The 7-value enum: `end_turn | max_tokens | stop_sequence | tool_use |
pause_turn | refusal | model_context_window_exceeded`. Falling out of the loop
instead of returning here means we ran out of rounds.

**Running the tools**

```ts
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
```

Round 1 fetches the tool results, pushes them into `history`, then round 2 gets
the final answer.

**Running out of rounds is an answer too**

```ts
controller.enqueue(frame({
	type: "error",
	message: `Stopped after ${MAX_ROUNDS} tool rounds without a final answer.`
}));
controller.close();
```

Falling out of the loop means the model kept asking for tools and never
converged. Say so instead of leaving the stream hanging open.

**`catch` frames, it doesn't throw**

```ts
} catch (err) {
	console.error("chat stream failed:", err);
	controller.enqueue(frame({ type: "error", message: apiErrorMessage(err) }));
	controller.close();
}
```

The status code was spent on the first byte, so an error after that can only
travel as a frame. Frame it and close cleanly.

**`cancel()`**

```ts
cancel() {
	currentStream?.abort();
}
```

Client aborted — stop paying for tokens nobody will read. `currentStream`, not
`stream`: the loop may be on its third request by the time this fires.

### `hooks/useChat.ts`

**`ChatMessage` carries UI-only fields**

```ts
export type ChatMessage = Anthropic.MessageParam & {
  stopped?: boolean;
  usage?: UsageInfo;
};

const toPayload = (messages: ChatMessage[]): Anthropic.MessageParam[] =>
  messages.map(({ role, content }) => ({ role, content }));
```

`stopped` is UI metadata, not part of the API payload — it has to be stripped
before the message is sent, or the API rejects the extra field. `usage` is the
same: what that turn cost, kept for display only.

**One string, not a block array**

```ts
// declared outside try so finally can read it
let answerText = "";
```

Only text streams in delta by delta; `tool_use` and `thinking` arrive whole
inside a `turn` frame, so a single string is all the in-flight answer ever needs.

**Check `response.ok` before reading**

```ts
if (!response.ok) {
	throw new Error(`Request failed: ${response.status}`);
}
```

The status locks once streaming starts, so check it here.

**The NDJSON buffer**

```ts
const reader = response.body?.getReader();
const decoder = new TextDecoder();
let buffer = "";

buffer += decoder.decode(value, { stream: true });
const lines = buffer.split("\n");
buffer = lines.pop() ?? ""; // the trailing partial line
```

A chunk boundary can land mid-JSON-object. `lines.pop()` holds the incomplete
tail back until the next chunk completes it.

**Accumulating text**

```ts
if (frame.type === "text") {
  answerText += frame.text;
  setReply([{ type: "text", text: answerText }]);
}
```

Append to one growing string instead of pushing a block per delta: a long answer
would otherwise become hundreds of blocks, and markdown spanning a chunk
boundary (`**bo` + `ld**`) would be parsed in halves and never render.

A fresh array every time — React re-renders on reference change, so mutating in
place would leave the screen frozen.

**The error frame arrives inside a 200**

```ts
} else if (frame.type === "error") {
	throw new Error(frame.message);
}
```

The status was spent on the first byte, so this is the only channel left.

**Was it a stop or a failure?**

```ts
} catch (err) {
	if (!controller.signal.aborted) {
		console.error("Error sending message:", err);
		setError(/* ... */);
	}
}
```

Ask the controller whether this was a user stop, instead of guessing from the
shape of the error object.

**`finally` commits a stopped answer**

```ts
} finally {
	if (controller.signal.aborted && answerText.trim()) {
		setMessages((prev) => [
			...prev,
			{ role: "assistant", content: [{ type: "text", text: answerText }], stopped: true },
		]);
	}
	setReply([]);
	setStreaming(false);
	abortRef.current = null;
}
```

A user stop leaves the partial answer only in `answerText` — no `turn` frame
ever arrived to commit it — so write it into history here, or it vanishes when
`setReply([])` clears the screen. And clearing `reply` is mandatory once the
answer lives in history: leaving it would show the same text twice.

### `app/page.tsx`

**`ToolCall` — a rule, not a box**

```tsx
function ToolCall({ name, input }: { name: string; input: unknown }) {
  // ...
  return (
    <div className="not-prose my-3 border-l-2 border-(--accent) pl-3 font-mono">
```

A tool call is metadata about how the answer was produced, not part of the
answer. `not-prose` keeps the typography plugin off it.

**`ToolResult` — `<details>`, zero JS**

```tsx
<details className="not-prose my-3 border-l-2 border-(--border) pl-3 font-mono">
  <summary>result · {text.length} chars</summary>
  <pre className="mt-1 max-h-64 overflow-auto ...">{body}</pre>
</details>
```

Tool output is debugging detail, not conversation — 100 lines of JSON has no
business shouting. `<details>` collapses it with zero JS and zero state.

**`UsageLine` — three numbers, not one**

```tsx
function UsageLine({ usage }: { usage: NonNullable<ChatMessage["usage"]> }) {
  const s = summarize(usage);
  return (
    <div className="font-mono text-[11px] text-(--muted)">
      {s.promptTokens} in ({s.cacheRead} cached · {s.cacheWrite} new ·{" "}
      {s.uncached} fresh) → {s.outputTokens} out
      {s.cost !== null && ` · $${s.cost.toFixed(5)}`}
    </div>
  );
}
```

The three prompt-token fields are disjoint and priced differently: cached ~0.1×,
new 1.25× (write), fresh 1×. Short chats show zeros — the prefix hasn't reached
the minimum cacheable length yet.

**`memo` on `Message`**

```tsx
const Message = memo(function Message({ message, streaming }: { ... }) {
```

Appending keeps past message objects referentially identical, so they skip
re-render while a new answer streams. Markdown parsing is worth the compare.

**`stickToBottom` is a ref, not state**

```tsx
const stickToBottom = useRef(true);

useEffect(() => {
	if (stickToBottom.current) bottomRef.current?.scrollIntoView();
}, [reply, messages]);
```

Reading it must not trigger a re-render, so it's a ref, not state. Only scroll
if the user was already at the bottom — see
[Auto-scroll has to yield to the user](#auto-scroll-has-to-yield-to-the-user).

**`handleScroll` records, it doesn't scroll**

```tsx
const handleScroll = () => {
	const el = scrollRef.current;
	if (!el) return;
	const { scrollTop, scrollHeight, clientHeight } = el;
	stickToBottom.current = scrollHeight - scrollTop - clientHeight < 100;
};
```

`clientHeight` is the viewport, `scrollHeight` the content, `scrollTop` the
offset. Within 100px of the bottom counts as sticking.

**Auto-grow needs the reset**

```tsx
useEffect(() => {
	const el = textareaRef.current;
	if (!el) return;
	el.style.height = "auto";
	el.style.height = `${el.scrollHeight}px`;
}, [input]);
```

`scrollHeight` never reports less than the current height, so without the
reset-to-`auto` the box could only grow. The pair is load-bearing.

**Enter vs. Shift+Enter vs. IME**

```tsx
const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
	if (e.nativeEvent.isComposing) return;
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		submit();
	}
}
```

Shift+Enter falls through to the textarea's own newline handling; `isComposing`
guards the IME preedit — see
[Enter during an IME preedit isn't yours](#enter-during-an-ime-preedit-isnt-yours).

**Layout notes**

```tsx
<main className="flex w-full h-dvh max-w-3xl flex-col bg-white">
{/* ... */}
{streaming && <Message streaming message={{role: "assistant", content: reply}} />}
```

`dvh` = dynamic viewport height. The in-flight answer renders *after* history,
so order stays chronological.

### `app/globals.css`

Full reasoning for these lives in [UI / UX — what shipped](#ui--ux--what-shipped);
this section is the code plus the one-line why.

**Dark mode reassigns tokens, it doesn't swap them**

```css
@media (prefers-color-scheme: dark) {
  :root {
    --accent: #6c7cf0;
```

`#0e21a0` on a dark ground is ~1.3:1 — lighten saturated colors, don't reuse them.

**Strip the plugin's literal backticks**

```css
.prose :not(.not-prose *) code::before,
.prose :not(.not-prose *) code::after {
  content: none;
}
```

`none` removes the box; `""` would keep an empty one in layout.

**Compress the heading scale**

```css
.prose :is(h1, h2) { font-size: 1.25em; }
.prose :is(h3, h4) { font-size: 1.05em; }

.prose :is(h1, h2, h3, h4) code {
  font-size: inherit;
  font-weight: inherit;
}

.prose > :first-child { margin-top: 0; }
```

`prose`'s editorial scale (h1 at 2.2em) shouts in a chat column. Heading code
inherits size and weight so one line isn't two fonts at two sizes. The first
child has nothing above it.

**Inline code as a chip; `pre code` resets it**

```css
.prose :not(.not-prose *) code {
  background: var(--code-bg);
  padding: 0.15em 0.35em;
  /* ... */
}

.prose :not(.not-prose *) pre code {
  background: none;
  color: inherit;
  padding: 0;
  /* ... */
}
```

Asymmetric padding hugs the glyphs. A block is `<pre><code>`, so the chip styles
land on it too — reset them.

**Retheming via the plugin's own variables**

```css
.prose {
  --tw-prose-body: var(--foreground);
  --tw-prose-links: var(--accent);
  /* ... */
}
```

Reassigning the plugin's own custom properties is the supported retheme.

**The cursor is a pseudo-element**

```css
.streaming > :last-child::after,
.streaming:empty::after {
  content: "";
  display: inline-block;
  width: 0.5em;
  height: 1em;              /* em: grows inside a heading */
  background: currentColor; /* follows dark mode */
  animation: cursor-blink 1s steps(2, start) infinite;
}
```

Markdown emits block tags, and a block + an inline span can't share a line.
`:empty` covers the gap before the first token; `steps()` gives a hard blink.

**Scrollbar: invisible at rest**

```css
.scroll-slim {
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: transparent transparent; /* thumb, track */
}

.scroll-slim::-webkit-scrollbar { width: 4px; }
.scroll-slim::-webkit-scrollbar-thumb { background: transparent; }
.scroll-slim:hover::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--border) 30%, transparent);
}
```

WebKit ignores the standard properties in older Chrome and Safari — same effect,
vendor syntax.

---

## Tool errors and cancellation

> `lib/tools.ts`, `app/api/chat/route.ts`, `hooks/useChat.ts`

A tool that fails is not a turn that fails. The whole point of the error channel
is that the model keeps talking.

### Three ways to report a failure — only one of them works

| Approach | What the model sees | What the user sees |
| --- | --- | --- |
| `throw`, let it reach the outer catch | Nothing — the turn is over | Stream cuts off, a red error |
| Ordinary `tool_result` with `"error"` in the text | A normal result it has to interpret | The model may treat the error as data and invent an answer |
| **`tool_result` with `is_error: true`** | **An explicit failure signal** | The model explains and offers a next step |

`runTool` therefore never rejects — every call must produce a result:

```ts
export type ToolOutcome = { content: string; is_error?: boolean };

export async function runTool(name: string, input: unknown): Promise<ToolOutcome> {
	try {
		switch (name) {
			case "get_weather":
				return ok(await getWeather(input));
			case "get_stock_price":
				return ok(await getStockPrice(input));
			default:
				return fail(`Unknown tool: ${name}`);
		}
	} catch (err) {
		return fail(err instanceof Error ? err.message : String(err));
	}
}

const ok = (data: unknown): ToolOutcome => ({ content: JSON.stringify(data) });

const fail = (message: string): ToolOutcome => ({
	content: JSON.stringify({ error: message }),
	is_error: true,
});
```

The `try` has to wrap the whole `switch`, not sit outside `Promise.all` in the
route. `Promise.all` rejects on the first failure and discards the results that
*did* succeed — with three parallel calls, one throw loses the other two.

Error text is the model's only material for recovery, so name the alternatives:

```ts
throw new Error(`Unknown symbol: ${key}. Known symbols: ${Object.keys(PRICES).join(", ")}`);
```

Asked for `FAKECORP`, the model answered entirely out of that string — "不是一个
有效的股票代码", then listed AAPL / NVDA / TSLA and offered to look one up. No
invented price.

### Every `tool_use` needs a `tool_result`, in the very next message

Not a style rule — the API rejects the request. Replaying a history whose
`tool_use` has no answer:

```
400: messages.2: `tool_use` ids were found without `tool_result` blocks
immediately after: toolu_01ABC. Each `tool_use` block must have a
corresponding `tool_result` block in the next message.
```

Two consequences, both load-bearing:

1. **All results go in one user message.** Splitting them across several messages
   is accepted, but it teaches the model that parallel calls get fragmented
   replies — it quietly stops making them. No error, just a slow regression.
2. **A cancelled round has to be closed out.** `turn` and `tool_result` are
   separate frames, and the server runs the tools between them. Abort in that
   window and the client has already committed an assistant message carrying a
   `tool_use` that will never be answered — every later request 400s and the
   conversation is unrecoverable without a reload.

`finally` handles both stop cases, and they are mutually exclusive — the abort
either landed in streaming text or inside a tool round:

```ts
} finally {
  if (controller.signal.aborted) {
    setMessages((prev) => {
      // stopped mid-answer: commit what streamed in
      if (answerText.trim()) {
        return [...prev, {
          role: "assistant",
          content: [{ type: "text", text: answerText }],
          stopped: true,
        }];
      }

      // stopped between tool_use and tool_result: close the round out
      const last = prev.at(-1);
      if (last?.role !== "assistant" || !Array.isArray(last.content)) return prev;

      const pending = last.content.filter((b) => b.type === "tool_use");
      if (pending.length === 0) return prev;

      return [...prev, {
        role: "user",
        content: pending.map((b) => ({
          type: "tool_result" as const,
          tool_use_id: b.id,
          content: JSON.stringify({ error: "Cancelled by user" }),
          is_error: true,
        })),
      }];
    });
  }
  setReply([]);
  setStreaming(false);
  abortRef.current = null;
}
```

Replayed, that history is accepted, and the cancellation reads as information
rather than damage — the model answered the new question and added: "刚才查询
AAPL 的请求被取消了，如果你还需要，可以告诉我，我再重新查一下。"

### The error signal outlives its own turn

`is_error` stays in the transcript. Asked the same dead ticker a second time, the
model answered `end_turn` with **no tool call at all** — it had already learned
the symbol doesn't exist. A `throw` leaves nothing behind to learn from.

### A failed send must not stay in history

A request that fails leaves its user message in `messages` with no assistant
reply. Left alone it is re-sent on every subsequent turn — tokens paid forever,
and the model eventually answers a pile of stale questions at once.

`failed` is UI-only state, and the filter belongs where `history` is built,
because that one array feeds both the display and the payload:

```ts
const userMessage: ChatMessage = { role: "user", content: text };
const history = [...messages.filter((m) => !m.failed), userMessage];

setMessages(history);                                    // what the UI shows
body: JSON.stringify({ messages: toPayload(history) }),  // what gets sent
```

Marking is by object identity, not index — a failure can land after earlier
`turn` and `tool_result` messages were already committed, so the user's message
is not necessarily last:

```ts
setMessages((prev) => prev.map((m) => (m === userMessage ? { ...m, failed: true } : m)));
```

Retry then needs no state surgery of its own:

```ts
const retry = () => {
  const failed = messages.findLast((m) => m.failed);
  if (failed && typeof failed.content === "string") send(failed.content);
};
```

The naive version — `setMessages(filter)` and then `send()` — silently fails:
`send` reads `messages` from the render closure, which `setMessages` does not
update. Verified on the wire: after an offline failure and a retry, the payload
contained exactly one copy of the question and no trace of the failed message.

In the UI, only the failed message gets the callback:

```tsx
<Message key={i} message={msg} onRetry={msg.failed ? retry : undefined} />
```

`retry` closes over `messages`, so it is a new function every render (`useCallback`
can't fix that — the dependency changes). Passing it to every `Message` breaks
`memo` for all of them and re-parses every message's markdown on each streamed
token. `undefined` is referentially stable, so only the one failed message
re-renders.

### Thinking blocks ride along

`claude-sonnet-5` runs adaptive thinking by default with `display: "omitted"`, so
`turn` frames carry a thinking block with empty text and a signature:

```json
{"type":"thinking","thinking":"","signature":"EpADCpABCBEYAipAkwtAISXFRc6h..."}
```

It must be echoed back unchanged and stay first in the assistant content. Storing
the whole `content` array does this for free. For readable reasoning, ask for it:
`thinking: { type: "adaptive", display: "summarized" }`.

### Caching, measured

Cold turn on a fresh conversation: `1670 in (0 cached · 0 new · 1670 fresh)` —
nothing cached, because the prefix hadn't reached the minimum cacheable length.
Once the history grew:

```json
"input_tokens": 4,
"cache_creation_input_tokens": 140,
"cache_read_input_tokens": 2140
```

2140 tokens read from cache, 4 at full price. Caching works; short chats just
don't reach the floor. Adding or editing a tool definition invalidates all of it
— `tools` renders in front of `system`.

---

## TODO

### Tool use

Done: `tool_use` / `tool_result` rendering, `turn` frames so tool blocks survive
into the next turn, a second tool, a tool that fails via `is_error`, retry after
a failed send, and cancellation of an in-flight tool round. See
[Tool errors and cancellation](#tool-errors-and-cancellation).

- [ ] Stream thinking (`display: "summarized"`) — the wait between the question
      and the first `tool_use` is still a blank screen.
- [ ] A tool that is slow rather than broken, to see the loop under latency.

### Caching

- [x] Verify caching still works after a change to prompt assembly — measured
      `cache_read_input_tokens: 2140` against 4 uncached. The failure mode is
      silent (requests keep succeeding, the bill is just higher), so this needs
      an assertion, not a one-time eyeball. Tool definitions sit in front of the
      prefix — editing one invalidates everything.
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
