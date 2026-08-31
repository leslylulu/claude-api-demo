import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function POST(req: Request) {
	const { messages } = await req.json();
	// if role is system, will throw 400 code
	// console.log("messages ===", messages);

	if (!Array.isArray(messages) || messages.length === 0) {
		return new Response("Messages cannot be empty", { status: 400 });
	}

	if (messages.some((message: unknown) => (message as Anthropic.MessageParam)?.role === "system")) {
		return new Response("System role is not allowed", { status: 400 });
	}

	const stream = client.messages.stream({
		model: "claude-sonnet-4-6",
		max_tokens: 1024,
		temperature: 0.5, // 0
		system: "You are a helpful assistant from Claude and model is claude-sonnet-4-6.",
		messages: messages
	});

	const encoder = new TextEncoder();

	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				for await (const event of stream) {
					// text_delta is the only event carrying real text; the rest is metadata
					if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
						controller.enqueue(encoder.encode(event.delta.text));
					}
				}

				const final = await stream.finalMessage();
				if (final.stop_reason === "max_tokens") {
					controller.enqueue(encoder.encode("\n\n[truncated: hit max_tokens]"));
				}

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
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			"X-Content-Type-Options": "nosniff"
		}
	});
}
