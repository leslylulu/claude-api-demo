import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { CheckinSchema } from "./checkin";
import { SYSTEM_PROMPT, buildContent, type PromptInput } from "./prompt";

const client = new Anthropic();

export const MODEL = "claude-sonnet-5";
export const EFFORT = "medium" as const;

export function runCheckIn(input: PromptInput){
	const content = buildContent(input)
	// console.log('content=== ', content)
	return client.messages.parse({
		model: MODEL,
		max_tokens: 2048,
		system: [
			{
				type: "text",
				text: SYSTEM_PROMPT,
				cache_control: { type: "ephemeral"}
			}
		],
		messages: [
			{ role: "user", content: content }
		],
		output_config: {
			effort: EFFORT,
			format: zodOutputFormat(CheckinSchema)
		}
	})
	
}
