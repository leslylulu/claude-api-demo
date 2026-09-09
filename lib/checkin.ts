import { z } from "zod";
import { QUOTE_IDS } from "./quotes";


export const FEELINGS = [
	"self_blame", 
	"anxious",
	"drained",
	"avoidant",
	"stuck", 
	"steady",
	"comparison",
] as const;

export type Feeling = (typeof FEELINGS)[number];


export const CheckinSchema = z.object({
	
	feeling: z.enum(FEELINGS).describe("The emotional state behind what they wrote, not the state of their task."),
	line: z
		.object({
			text: z.string(),
			based_on: z
				.enum(QUOTE_IDS).nullable()
		})
		.nullable()
		.describe("If there aren't any suitable quotes in the database, write your own—but it must follow the same rules (one or two sentences, a single idea, and no consoling afterthoughts"),


	separation: z
		.string()
		.nullable()
		.describe(
			"One or two sentences separating the act from the person — the gap between what happened and the verdict they passed on themselves. Null when they passed no verdict; a note that is simply a report of a day does not need reframing.",
		),

	capability: z
		.string()
		.describe("One thing they already did, in their own words, that shows a small competence. State what you noticed and stop — do not explain what it proves about them, and never turn it into praise or a task."),

	ask_for_reason: z
		.string()
		.nullable()
		.describe("If your_reason is null or very thin, one gentle question inviting them to say why this matters. Null otherwise."),


	needs_human: z
		.boolean()
		.describe("True only for sustained hopelessness, self-harm, or anything beyond a hard day. When true, everything above is ignored."),
});

export type Checkin = z.infer<typeof CheckinSchema>;
