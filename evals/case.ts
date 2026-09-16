import type { PastEntry, CheckinStats } from "@/lib/prompt";
import type { Feeling } from "@/lib/checkin";

type Tone = "positive" | "neutral" | "negative";

export type Expect = {
	emotion?: "present" | "null";
	action?: "present" | "null";
	encouragement?: "present" | "null";
	ask_for_reason?: "present" | "null";
	tone?: Tone;
	feeling?: Feeling;
	needs_human?: boolean;
};

export type Case = {
	id: string;
	because: string;
	goal: string;
	why?: string;
	note: string;
	history?: PastEntry[];
	stats: CheckinStats;
	expect: Expect;
};

const ENGLISH = "Get comfortable speaking English";
const ENGLISH_WHY = "So that an interview in English stops being the thing I dread.";

const SHIP = "把这个 app 做完上线";
const SHIP_WHY = "我想有个东西是我自己从头做出来的，能拿给别人看。";

const WEIGHT = "Weight Loss";
const WEIGHT_WHY = "Boost My confidence! I can wear stylish clothes.";

const stats = (item: Partial<CheckinStats> = {}): CheckinStats => ({
	days: 1,
	hardDays: 0,
	goodDays: 0,
	dayNumber: 1,
	...item,
});

export const CASES: Case[] = [
	{
		id: "ui-test-empty-options",
		because: `A good day should not produce a question. Nothing is missing and nothing contradicts, 
			so ask_for_reason has to stay null. This is the model at its most tempted to add one anyway, 
			since it wants to say "keep it up tomorrow!" - 
			the test only checks it resists turning that encouragement into a question.`
			.replace(/\s+/g, " ")
			.trim(),
		goal: ENGLISH,
		why: ENGLISH_WHY,
		note: "Did my 20 minutes. Nothing special.",
		stats: stats({ days: 4, dayNumber: 6 }),
		expect: { ask_for_reason: "null", tone: "neutral" },
	},
	{
		id: "venting",
		because: `Real note. This is venting — loud, cheerful, not distress. 
		It came back tone:negative, which turned on the whole separation machinery and made the card 
		argue against a verdict they never passed. Stable across runs, so this is the model being 
		consistently wrong, not flaky: tone's negative covers "did not do it" and says nothing about 
		how loud they are while not doing it.`
			.replace(/\s+/g, " ")
			.trim(),
		goal: WEIGHT,
		why: WEIGHT_WHY,
		note: "I drink it every day! I'm used to it! I feel bad if I don't have it! Plus, it tastes great!",
		history: [
			{ day: "2026-09-13", note: "Walked 30 minutes. Bought a latte on the way home lol" },
			{ day: "2026-09-14", note: "Nothing much today." },
			{ day: "2026-09-15", note: "The coffee thing is getting out of hand. Two a day now." },
		],
		stats: stats({
			days: 9,
			dayNumber: 14,
			hardDays: 2,
		}),
		expect: {
			tone: "neutral",
			ask_for_reason: "null",
		},
	},
	{
		id: "english-note-chinese-history",
		because:
			"Real card. The note was English and the whole card came back in Chinese. " +
			"SYSTEM_PROMPT's LANGUAGE rule says to follow the note even when the GOAL is in " +
			"another language — it says nothing about the earlier notes. A first attempt kept " +
			"goal and why in English to isolate history as the variable, and it did not " +
			"reproduce: two Chinese notes are not enough to pull the model off. This version " +
			"matches the real row instead — everything Chinese except today's line. Reproduce " +
			"first, isolate second.",
		goal: SHIP,
		why: SHIP_WHY,
		note: "I'm still adjusting the prompt and schema's describe! I have to say it is a not easy thing todo!",
		history: [
			{ day: "2026-09-12", note: "今天把时区那块打通了，折腾到很晚。" },
			{ day: "2026-09-13", note: "拆了组件，页面终于没那么乱了。" },
			{ day: "2026-09-14", note: "今天改了半天 prompt，还是不太对。" },
			{ day: "2026-09-15", note: "又调了一轮 describe，有点累了。" },
		],
		stats: stats({
			days: 6,
			dayNumber: 8,
			hardDays: 3,
		}),
		expect: {
			tone: "negative",
		},
	},
	{
		id: "cold-not-started",
		because:
			`Real card, three violations at once: encouragement restated action's fact 
		("you didn't move" vs "Nothing has started yet"), action said "not a mark against you" — 
		arguing against a verdict never passed — and both fields credited them for checking in. 
		None of the three are visible to a present/null check. tone has come back negative, neutral, 
		negative across three runs, so the assertion below is flaky by nature: negative's "did not do it" 
		and neutral's "a bare status" both fit this note, and the model picks one at random.`
				.replace(/\s+/g, " ")
				.trim(),
		goal: WEIGHT,
		why: WEIGHT_WHY,
		note: "No I havn't start yet! So cold!",
		stats: stats(),
		expect: {
			tone: "negative",
			encouragement: "present",
			feeling: "avoidant",
		},
	},
	{
		id: "good-day-no-push",
		because:
			`Going well is where the model starts coaching. The describe() forbids a next step on a positive day — 
			they have had their encouragement for today — and that is exactly when "keep it up tomorrow!" shows up. 
			They also mention time themselves ("easier than last week"), which is one of the few openings where 
			action may reach for a number — so this is the case that catches a number that was never in stats.`
				.replace(/\s+/g, " ")
				.trim(),
		goal: ENGLISH,
		why: ENGLISH_WHY,
		note: "Talked to a colleague in English for ten minutes today and didn't freeze up. Way easier than last week.",
		stats: stats({ days: 11, dayNumber: 15, goodDays: 4, hardDays: 3 }),
		expect: {
			tone: "positive",
			ask_for_reason: "null",
		},
	},
];
