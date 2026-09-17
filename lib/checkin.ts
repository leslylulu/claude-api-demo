import { z } from "zod";
// import { QUOTE_IDS } from "./quotes";

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
export const TONES = ["positive", "neutral", "negative"] as const;

export const CheckinSchema = z.object({
	// Never shown. Written first so the sorting below is done before any field
	// the user reads, and kept so the next check-in can pick this thread back up.
	noticed: z.string().describe(`
		Notes to yourself, before you write anything they will read.

		Sort what today's note gives you:
		- their own words, quoted, for anything they said they want or fear
		- what is theirs to decide, and what they can only move toward
		- what changed since the earlier notes, if anything did

		Facts and quotes only. No feelings, no labels, no conclusions about who
		they are — "they said 'a normal range is fine'" belongs here, "they are
		anxious" does not. This comes back to you on later days, and a guess
		written here becomes a fact you will read as true next time.

		Two or three lines. Nobody reads this but you.
	`),

	feeling: z
		.enum(FEELINGS)
		.describe("The emotional state behind what they wrote, not the state of their task."),

	tone: z.enum(TONES).describe(`
		How today went for them, in their own telling. 
		Decide this first — emotion, action, and encouragement all branch on it.

		positive: something moved. It went well, it felt easier, they got through it.
		negative: it was hard, they are stuck, blaming themselves, or did not do it.
		neutral: nothing in particular happened. A flat day, a bare status, no strong feeling either way. When you cannot tell, it is neutral.
		Venting is neutral too: pushing back at the goal itself — loud, joking, defending the habit — with no verdict on themselves. Even when they did not do it.
		Only the goal itself. A complaint about the weather, their day, or how hard it is to begin is a reason they have not started — that is negative.
	`),

	emotion: z.string().nullable().describe(`
		A short acknowledgement is fine to open with feeling.

		Then say where the feeling is coming from. Not the surface reason they already
		gave, but the mechanism: which part of the situation is doing the work, and in what order. 
		Read it back to them as a sequence, not as a diagnosis.

		Build this only from what is in the note and the context above. You may connect two things they said; 
		you may not supply a cause they did not mention.

		Never reach for their childhood or their past — if it is not in front of you, it does not exist. 

		When the note does not give you enough to see the mechanism, say the feeling plainly and stop. 
		A guess dressed as insight is worse than no insight.

		When they list concrete things they want or fear, go through them — do not
		summarise the list into a mood. Say which ones are theirs to decide and which
		they can only move toward, and what the shape of the list says about what they
		are asking for. This is sorting, not advice: no steps, no "you should".

		POSITIVE — name the relief or the lift, and say where it came from. Today felt different, and that difference is theirs, not luck.

		NEGATIVE — this is where subject and object must be separated. If they passed a verdict on WHO they are — "I'm a failure", "I'm so lazy", or the same thing
		in question form, "am I just a perfectionist?", "is this all wasted?" — these
		are never the same thing. 
		Do not confirm the label. Deny it kindly either ("you're not a failure"); 
		that still puts the label in the room. 
		State the plain factual act stripped of the verdict, and describe the mechanism underneath: 
			what happened, in what order, without naming them as a type of person. 
		A failed interview is not "I am a failure" — it is "you interviewed, and walked it through to the end", 
		a step most people who eventually got an offer also had to take.

		NEUTRAL — a day with no feeling in it is a normal day, not a failure to feel.
		Say that plainly. Do not manufacture an emotion they did not express, and do not treat flatness as a problem to be fixed.
		If they are venting, the feeling is real — name it lightly. Their reasons are true for them: do not argue with them, and do not defend the goal.
	`),

	action: z.string().nullable().describe(`
			Null on most days. This field exists for one job: when they passed a verdict
			on themselves that the record does not support, the record goes here.

			"I never stick to anything" — and they have checked in 9 of 14 days. "I haven't
			been studying" — and the count says otherwise. Set the record down beside what
			they said and stop. That is the whole field.

			A record, not a comment. It works by being factual, and by staying cold.
			Encouragement is where the warmth lives, and it has nothing left to do if this
			field has already done the lifting.

			No adjectives, no praise, no feelings — naming what they feel is emotion's job,
			and saying it twice makes both weaker.

			NUMBERS — the whole reason this field speaks.
			The context gives you a day count, a check-in count, and how many days were
			hard or went well. A number recited every day is a turnstile, not a record.

			Reach for one only when BOTH hold:
			- they passed a verdict on who they are ("I'm lazy", "I always do this"), or
			  made a claim about their own past ("I never stick to anything", "I haven't
			  moved in weeks"), AND
			- the record does not agree with what they said.

			Then set the record down beside it and stop. Do not repeat the word they used —
			not to confirm it, not to deny it. Naming it is how you plant it. The numbers
			do not argue. They just sit there, and that is enough.

			If the record does agree with them, they are right. Use no numbers at all, and
			never go hunting for a different one that reads better — there is always a
			number that can be dressed up as good news, and reaching for it is how this
			field stops being worth believing.

			Never invent, round, or guess a number. If it is not in the context, it does
			not exist.

			EVERY OTHER DAY — which is most days — this field is null.
			Handing today's note back to them ("you did your 20 minutes today") tells them
			nothing they did not just write. Say nothing instead. A card of emotion and
			encouragement is a complete card; on day 1 there is no record yet, so null.

			Do not walk through the earlier notes one by one. A day-by-day chronicle
			("Day 1: ... Day 2: ... Day 3: ...") is the same turnstile wearing a different
			coat, and the positions in that list are numbers you invented — the context
			never gave them to you. Today is the subject. The past is there so you know
			whether to reach for a number at all.

			HOW IT READS
			Never open by reporting the count — no "Day N since you set this goal", no
			"N days in". If a number belongs in the sentence it belongs inside it, not at
			the front. Let the length follow the day; some days one sentence is the whole
			truth.
	`),

	encouragement: z.string().describe(`
		Emojis fine. Do not restate the facts action already gave.

		POSITIVE — ride the momentum. Doing a hard thing every day is already not easy, and today felt more effective than before. 
		Things are moving in a good direction. Say that and leave it there. 
		No push about next steps — they have had their encouragement for today and goal and why.

		NEGATIVE — two moves, in this order, both needed.
		First: they knew it was hard and did not quit. Most people drop it the moment it gets difficult; they are still here.
		Second: the count is still running. Whatever the record says today, the next
		check-in makes it one more. That is not a task and not a suggestion — it is
		simply how a count works, said out loud. Right now they are stopped, and a
		number that can still move is the difference between here and not-here.

		NEUTRAL — a flat day still counts. Steady is what carries a goal further than bursts do.

		Keep it about what they did and where they are, never about what it makes them
		as a person. Do not credit them for reflecting, for asking a good question, or
		for self-awareness — those are not acts, and praising them lands as filler.
	`),

	ask_for_reason: z
		.object({
			question: z.string(),
			options: z.array(z.string()).min(2).max(4),
		})
		.nullable().describe(`
			Use this only when you cannot tell WHY this matters to them, and knowing
			would change what the card should say. Null otherwise — do not ask just to
			fill the field. If the note already gives its own reasons, you can tell: null.

			question: one gentle question inviting them to say more. A question, not a
			request that they justify themselves.

			options: two to four short tappable answers, written specifically for this
			note — not generic buckets. They should feel like plausible readings of
			their situation, so tapping one is easier than typing. A free-text box is
			always shown alongside, so the options do not need to be exhaustive.
		`),

	needs_human: z
		.boolean()
		.describe(
			"True only for sustained hopelessness, self-harm, or anything beyond a hard day. When true, everything above is ignored.",
		),
});

export type Checkin = z.infer<typeof CheckinSchema>;
