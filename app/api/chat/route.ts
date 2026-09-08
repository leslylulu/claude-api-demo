import { runTool } from "@/lib/tools";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const MODEL = "claude-sonnet-5";
const MAX_ROUNDS = 10; // max turns of conversation before we give up and close the stream

// Kept at module scope so the string stays byte-identical across requests —
// a stable prefix is what prompt caching needs. Never interpolate a date, a
// user id, or a feature flag in here: it sits at the front of the prefix, so
// one changed byte makes every cached turn behind it uncacheable.
const SYSTEM_PROMPT = `You are a helpful assistant in a chat app.
- Answer in the same language the user writes in.
- Use markdown for structure: headings, lists, tables, code blocks.
- Be concise. Prefer three short paragraphs over ten.
- If you are unsure, say so instead of guessing.`;

const TOOLS: Anthropic.Tool[] = [
	{
		name: "get_weather",
		description: "Get the current weather for a given city. Use this whenever the user asks about the weather, temperature, or forecast. The city must be specified in the input. Show details in next 24 hours, including temperature, humidity, wind speed, and precipitation. Also provide a brief summary of the weather conditions.",
		input_schema: {
			type: "object",
			properties: {
				city: { type: "string", description: "The city to get the weather for." },
			},
			required: ["city"],
		}
	}
]

// Enum: maybe "thinking", "tool_use", "tool_result", "text", "usage", "image", "citation"
// "start", "error", "metadata" ...etc. are all possible, but we only care about text and usage here.
type Frame =
	| { type: "text"; text: string }
	| {
			type: "usage";
			model: string;
			stop_reason: Anthropic.Message["stop_reason"];
			usage: Anthropic.Usage;
		}
	| { type: "error"; message: string }
	| { type: "tool_use"; id: string; name: string; input: unknown }

// err.message on an APIError is the status plus the whole raw JSON body. The
// human-readable sentence lives in the parsed payload; dig it out.
const apiErrorMessage = (err: unknown) => {
	if (!(err instanceof Anthropic.APIError)) return "Upstream request failed.";
	const body = err.error as { error?: { message?: string } } | undefined;
	return `${err.status}: ${body?.error?.message ?? err.message}`;
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

	let currentStream: ReturnType<typeof client.messages.stream> | null = null;


	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				const history: Anthropic.MessageCreateParams["messages"] = [...messages];

				// One turn can now cost several requests. final.usage covers only the
				// last of them, so the numbers have to be carried across rounds.
				const totals = {
					input_tokens: 0,
					output_tokens: 0,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0
				};

				for(let round = 0; round < MAX_ROUNDS; round++) {

					const stream = client.messages.stream({
						model: MODEL,
						max_tokens: 4096,
						cache_control: { type: "ephemeral" },
						system: SYSTEM_PROMPT,
						tools: TOOLS,
						messages: history
					});

					// if want to know results earlier, can use `.on('contentBlock', (block) => {})` to get contentBlock as soon as it arrives, 
					// but the final message is only available after the stream is done.

					currentStream = stream;

					for await (const event of stream) {
						//type of event: message_start, content_block_start, content_block_delta X n, content_block_stop, message_delta, message_stop
						// console.log("chat stream event ===", event);	
						if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
							controller.enqueue(
								frame({
									type: "text",
									text: event.delta.text
								}));
						}
					}


					const final = await stream.finalMessage();

					totals.input_tokens += final.usage.input_tokens;
					totals.output_tokens += final.usage.output_tokens;
					totals.cache_creation_input_tokens += final.usage.cache_creation_input_tokens ?? 0;
					totals.cache_read_input_tokens += final.usage.cache_read_input_tokens ?? 0;

					// 7 stop_reason enum: end_turn | max_tokens | stop_sequence | tool_use | pause_turn | refusal | model_context_window_exceeded
					// console.log("final ===", final);

					if (final.stop_reason !== "tool_use") {

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
								usage: { ...final.usage, ...totals }
							})
						);

						controller.close();
						return; // the only successful exit; falling out of the loop means we ran out of rounds
					} 


					// here means use tool_use

					const calls = final.content.filter(
						(b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
					);

					// The next token is a whole round-trip away; without this the UI just
					// freezes for the duration of the tool call.
					for (const call of calls) {
						controller.enqueue(
							frame({ type: "tool_use", id: call.id, name: call.name, input: call.input })
						);
					}
					//COMMENT round 1 to fetch tool results, then push to history, then round 2 to get final answer
					const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
						calls.map(async (call) => ({
							type: "tool_result" as const,
							tool_use_id: call.id,
							content: await runTool(call.name, call.input),
						}))
					);

					// console.log("tool results ===", results);

					history.push({
						role: "assistant",
						content: final.content
					});
					history.push({
						role: "user",
						content: results
					});
				} // end loop for MAX_ROUNDS

				// Falling out of the loop means the model kept asking for tools and
				// never converged. Say so instead of leaving the stream hanging open.
				controller.enqueue(
					frame({
						type: "error",
						message: `Stopped after ${MAX_ROUNDS} tool rounds without a final answer.`
					})
				);
				controller.close();
			} catch (err) {
				// frame and close cleanly instead.
				console.error("chat stream failed:", err);
				controller.enqueue(
					frame({
						type: "error",
						message: apiErrorMessage(err)
					})
				);
				controller.close();
			}
		},

		// client aborted — stop paying for tokens nobody will read
		cancel() {
			// stream.abort();
			currentStream?.abort();
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
