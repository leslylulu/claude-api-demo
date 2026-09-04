import type Anthropic from "@anthropic-ai/sdk";

// USD per 1M tokens, base rates. Cache reads bill at ~0.1x the input rate and
// cache writes at ~1.25x (5-minute TTL) — so a prefix pays for itself on the
// second request: 1.25 + 0.1 = 1.35 vs 2.0 uncached.
const PRICING: Record<string, { input: number; output: number }> = {
	"claude-opus-5": { input: 5, output: 25 },
	"claude-sonnet-5": { input: 2, output: 10 },
	"claude-sonnet-4-6": { input: 3, output: 15 },
	"claude-haiku-4-5": { input: 1, output: 5 }
};

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export type UsageInfo = {
	model: string;
	stop_reason: Anthropic.Message["stop_reason"];
	usage: Anthropic.Usage;
};

// `input_tokens` is the UNCACHED remainder only — the three fields are
// disjoint, so the real prompt size is the sum of all three. Reading
// input_tokens alone on a cached conversation under-reports it wildly.
export function summarize({ model, usage }: UsageInfo) {
	const uncached = usage.input_tokens;
	const cacheRead = usage.cache_read_input_tokens ?? 0;
	const cacheWrite = usage.cache_creation_input_tokens ?? 0;
	const promptTokens = uncached + cacheRead + cacheWrite;

	const price = PRICING[model.replace(/-\d{8}$/, "")];

	const cost = price
		? ((uncached +
				cacheRead * CACHE_READ_MULTIPLIER +
				cacheWrite * CACHE_WRITE_MULTIPLIER) *
				price.input +
				usage.output_tokens * price.output) /
			1_000_000
		: null;

	return {
		promptTokens,
		uncached,
		cacheRead,
		cacheWrite,
		outputTokens: usage.output_tokens,
		cost
	};
}
