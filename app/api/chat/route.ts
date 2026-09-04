import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const MODEL = "claude-sonnet-4-6";

// Kept at module scope so the string stays byte-identical across requests —
// a stable prefix is what prompt caching needs. Never interpolate a date, a
// user id, or a feature flag in here: it sits at the front of the prefix, so
// one changed byte makes every cached turn behind it uncacheable.
const SYSTEM_PROMPT = `You are a helpful assistant in a chat app.
- Answer in the same language the user writes in.
- Use markdown for structure: headings, lists, tables, code blocks.
- Be concise. Prefer three short paragraphs over ten.
- If you are unsure, say so instead of guessing.`;


// Enum: maybe "thinking", "tool_use", "tool_result", "text", "usage", "image", "citation"
// "start", "error", "metadata" ...etc. are all possible, but we only care about text and usage here.
type Frame =
	| { type: "text"; text: string }
	| {
			type: "usage";
			model: string;
			stop_reason: Anthropic.Message["stop_reason"];
			usage: Anthropic.Usage;
	};

const encoder = new TextEncoder();

const frame = (f: Frame) => encoder.encode(JSON.stringify(f) + "\n");
// obj -> string + \n : '{"type":"text","text":"hi"}\n'
// string -> Uint8Array: Uint8Array(31) [123, 34, 116, 121, 112, 101, ... , 10]

export async function POST(req: Request) {
	const { messages } = await req.json();

	if (!Array.isArray(messages) || messages.length === 0) {
		return new Response("Messages cannot be empty", { status: 400 });
	}

	if (messages.some((message: unknown) => (message as Anthropic.MessageParam)?.role === "system")) {
		return new Response("System role is not allowed", { status: 400 });
	}

	const stream = client.messages.stream({
		model: MODEL,
		max_tokens: 4096,
		temperature: 0.4,
		// Auto: system helps the model understand the context of the conversation and save tokens by caching the prefix
		// Explicit: suitable for when you want to control the prefix yourself, but you will pay for the entire prompt every time
		// COMMENT: Can use both :)
		//* DIFF: Can you control the which context be cached and when to use the cached context? 
		cache_control: { type: "ephemeral" },
		system: SYSTEM_PROMPT,
		messages: messages
	});

	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			const allEvents: any[] = [];
			try {
				for await (const event of stream) {
					allEvents.push(event);
					//type of event: message_start, content_block_start, content_block_delta X n, content_block_stop, message_delta, message_stop
					if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
						console.log("frame from back:", JSON.stringify({
							type: "text",
							text: event.delta.text
						})); 
						controller.enqueue(
							frame({ 
								type: "text", 
								text: event.delta.text 
							}));
					}
				}
				// resolves once the stream ends, with the assembled Message — this is
				// where stop_reason and the complete usage totals live
				const final = await stream.finalMessage();

				// 7 enum: end_turn | max_tokens | stop_sequence | tool_use | pause_turn | refusal | model_context_window_exceeded
				if (final.stop_reason === "max_tokens") {
					controller.enqueue(
						frame({ 
							type: "text", 
							text: "\n\n[truncated: hit max_tokens]" 
						})
					);
				}

				controller.enqueue(
					frame({
						type: "usage",
						model: final.model,
						stop_reason: final.stop_reason,
						usage: final.usage
					})
				);

				controller.close();
			} catch (err) {
				controller.error(err);
			}
		},

		// client aborted — stop paying for tokens nobody will read
		cancel() {
			stream.abort();
		}
	});

	return new Response(body, {
		headers: {
			"Content-Type": "application/x-ndjson; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			"X-Content-Type-Options": "nosniff"
		}
	});
}
