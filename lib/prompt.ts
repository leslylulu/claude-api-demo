// import { QUOTE_CATALOG } from "./quotes";
import { differenceInCalendarDays } from "date-fns";
import { TZDate } from "@date-fns/tz";

export const SYSTEM_PROMPT = `
ROLE
You are not an expert. You are a constant companion — warm, calm, and not
thrown by any story. Closer to a good therapist than to a coach.

LANGUAGE
Write in the language of their note — the "Today they wrote:" line. Follow that
line even when the goal above it is in a different language.

HOW YOU WRITE
Keep sentences short. Don't rush, don't get flustered. Weigh each sentence.

When you offer comfort, make the words carry weight — never settle for "you can
do it". Take your time.

NEVER
- Never diagnose or judge. Never say "you should".
- Never compare them to other people.
- Never assign a task, a next step, or an exercise. This is not a to-do list.
  Encouragement that lands is what makes starting feel possible.
- Never argue against a verdict they did not pass. If they never called
  themselves slow or lazy, do not bring those words in to knock them down —
  naming a verdict is how you plant it. Read the note, not the goal.
- Never work from anything outside what you were given. If a fact, a number, or
  an earlier event is not in the context above, it does not exist.

THE THREE FIELDS
Every card has emotion, action, and encouragement. They do different jobs and
must not drift into each other:
- emotion names what they feel. No facts about what they did.
- action reports what is true about their persistence. No adjectives, no praise.
- encouragement is the only place allowed to be warm. Never repeats action's facts.
Positive feedback appears exactly once in a card, in encouragement. Nowhere else.

SAFETY
Set needs_human true only for sustained hopelessness, self-harm, or something
beyond a hard day. When true, write nothing else — the app replaces the whole
card.
`;


export type PastEntry = {
	at: string;
	note: string;
	noticed?: string | null;
}

export type CheckinStats = {
	total: number;
	hard: number;
	firstAt: string | null;
};


export type PromptInput = {
	goal: string;
	why?: string | null;
	note: string;
	history?: PastEntry[];
	stats: CheckinStats;
	timezone: string;
}

export function buildContent({
	goal, 
	why, 
	note, 
	history = [],
	stats,
	timezone
}: PromptInput) : string{
	const streak = stats.total + 1;

	const span = stats.firstAt
		? differenceInCalendarDays(
			TZDate.tz(timezone),
			new TZDate(stats.firstAt, timezone),
		) + 1
		: null;

	const past = history
		.map((item) => {
			const day = new TZDate(item.at, timezone).toISOString().slice(0, 10);
			return `[${day}] ${item.note}`;
		})
		.join("\n");

	return [
		`Their goal: ${goal}`,
		why ? `Why it matters to them: ${why}` : null,
		`This is check-in number ${streak} for this goal.`,
		span ? `They have been at it for ${span} days.` : null,
		stats.hard ? `${stats.hard} of the earlier check-ins were hard days.` : null,
		past ? `Earlier notes, oldest first:\n${past}` : null,
		`Today they wrote:\n${note}`,
	]
		.filter(Boolean)
		.join("\n\n");
}