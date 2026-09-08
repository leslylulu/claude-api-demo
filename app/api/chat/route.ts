import { runTool } from "@/lib/tools";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const MODEL = "claude-sonnet-5";
const MAX_ROUNDS = 10; // tool rounds cap

// prompt caching: module scope, byte-identical prefix
const SYSTEM_PROMPT = `You are a helpful assistant in a chat app.
- Answer in the same language the user writes in.
- Use markdown for structure: headings, lists, tables, code blocks.
- Be concise. Prefer three short paragraphs over ten.
- If you are unsure, say so instead of guessing.
- When a tool fails, report only what the error message says. Do not add information from your own knowledge.`;

const TOOLS: Anthropic.Tool[] = [
	{
		name: "get_weather",
		description: "Get the current weather for a given city. Use this whenever the user asks about the weather or temperature. The city must be specified in the input. Returns the current condition, temperature in Celsius, and humidity.",
		input_schema: {
			type: "object",
			properties: {
				city: { type: "string", description: "The city to get the weather for." },
			},
			required: ["city"],
		}
	},
	{
		name: "get_stock_price",
		description: "Get the latest price for a stock ticker symbol. Use this when the user asks about a stock, share price, or ticker.",
		input_schema: {
			type: "object",
			properties: {
				symbol: {
					type: "string", description: "The ticker symbol, e.g. AAPL"
				},
			},
			required: ["symbol"],
		}
	}
]

// wire protocol — our frames, not the API's block enum
type Frame =
	| { type: "text"; text: string }
	| { type: "turn", content: Anthropic.ContentBlock[] } 
	| { type: "tool_result"; content: Anthropic.ToolResultBlockParam[] }
	| {
		type: "usage";
		model: string;
		stop_reason: Anthropic.Message["stop_reason"];
		usage: Anthropic.Usage;
	}
	| { type: "error"; message: string }


// APIError -> readable sentence
const apiErrorMessage = (err: unknown) => {
	if (!(err instanceof Anthropic.APIError)) return "Upstream request failed.";
	const body = err.error as { error?: { message?: string } } | undefined;
	return `${err.status}: ${body?.error?.message ?? err.message}`;
};

const encoder = new TextEncoder();

const frame = (f: Frame) => encoder.encode(JSON.stringify(f) + "\n"); // NDJSON

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

				// usage accumulates across rounds
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

					currentStream = stream;

					// message_start -> content_block_delta x n -> message_stop
					for await (const event of stream) {
						if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
							controller.enqueue(
								frame({
									type: "text",
									text: event.delta.text
								}));
						}
					}


					const final = await stream.finalMessage();
					// console.log('fff ===', final)
					const content: Anthropic.ContentBlock[] = final.stop_reason === "max_tokens" ? 
						[
							...final.content,
							{
								type: "text",
								text: "\n\n[truncated: hit max_tokens]",
								citations: []
							}
						]
						: final.content;
					

					controller.enqueue(
						frame({
							type: "turn",
							content
						})
					);


					totals.input_tokens += final.usage.input_tokens;
					totals.output_tokens += final.usage.output_tokens;
					totals.cache_creation_input_tokens += final.usage.cache_creation_input_tokens ?? 0;
					totals.cache_read_input_tokens += final.usage.cache_read_input_tokens ?? 0;

					// stop_reason enum: end_turn | max_tokens | stop_sequence | tool_use | pause_turn | refusal | model_context_window_exceeded
					if (final.stop_reason !== "tool_use") {

						controller.enqueue(
							frame({
								type: "usage",
								model: final.model,
								stop_reason: final.stop_reason,
								usage: { ...final.usage, ...totals }
							})
						);

						controller.close();
						return; // only successful exit
					} 


					// tool_use: round 1 fetches results, round 2 answers
					const calls = final.content.filter(
						(b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
					);

					const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
						calls.map(async (call) => {
							const outcome = await runTool(call.name, call.input);
							return {
								type: "tool_result" as const,
								tool_use_id: call.id,
								content: outcome.content,
								...(outcome.is_error && { is_error: true})
							}
						})
					);

					
					controller.enqueue(
						frame({
							type: "tool_result",
							content: results
						})
					);

					history.push({
						role: "assistant",
						content: final.content
					});
					history.push({
						role: "user",
						content: results
					});
					
				} // end loop for MAX_ROUNDS

				// ran out of rounds
				controller.enqueue(
					frame({
						type: "error",
						message: `Stopped after ${MAX_ROUNDS} tool rounds without a final answer.`
					})
				);
				controller.close();
			} catch (err) {
				// error frame, not a throw
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

		// client aborted
		cancel() {
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
