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
	
	feeling: z
		.enum(FEELINGS)
		.describe("The emotional state behind what they wrote, not the state of their task."),


	tone: z.enum(TONES).describe(`
		How today went for them, in their own telling. 
		Decide this first — emotion, action, and encouragement all branch on it.

		positive: something moved. It went well, it felt easier, they got through it.
		negative: it was hard, they are stuck, blaming themselves, or did not do it.
		neutral: nothing in particular happened. A flat day, a bare status, no strong feeling either way. When you cannot tell, it is neutral.
	`),

	emotion: z
		.string()
		.nullable()
		.describe(`
		A short acknowledgement is fine to open with feeling.

		Then say where the feeling is coming from. Not the surface reason they already
		gave, but the mechanism: which part of the situation is doing the work, and in what order. 
		Read it back to them as a sequence, not as a diagnosis.

		Build this only from what is in the note and the context above. You may connect two things they said; 
		you may not supply a cause they did not mention.

		Never reach for their childhood or their past — if it is not in front of you, it does not exist. 

		When the note does not give you enough to see the mechanism, say the feeling plainly and stop. 
		A guess dressed as insight is worse than no insight.

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
	`),


	action: z
		.string()
		.nullable()
		.describe(`
			This is self-suggestion, and it works by being factual.

			The context tells you which check-in number this is and how many days they have been at it. 
			Use those numbers — they are the anchor. Never invent, round, or guess them; if a number is not given to you, do not mention it.

			Read what they said to themselves, or what they did in this moment. Someone crediting themselves is positive. 
			Someone turning on themselves is negative.
			That is the signal, not whether the task went well.

			The core is the same in all three cases: this is the Nth time, it has been N
			days, the goal is still there, they are still on the way. What changes is
			where it lands:

			POSITIVE — say the streak back to them: N days at this goal, and they have not given up. 
			Today is one more on that line, and the ease they felt today sits on top of those days.

			NEGATIVE — three moves, in this order, kept short.

			First, the sentence they used against themselves. Point at the words, not at
			them — separate what happened from who they are, and say plainly that the one
			does not decide the other. One sentence.

			Then the record: they have been on this goal for N days. N of those check-ins
			were hard ones, and they are still here. Give the numbers as they are — the
			hard days are part of the count, not a break in it.

			Then let the suggestion stand. What they say to themselves settles in, so
			leave the true version in front of them and stop there.

			NEUTRAL — listen and answer like an old friend would. No lesson, no lift, just
			someone who has been around saying what they see.

			On a first check-in with no history, say that this is the start: they have begun, and that is what is true today.
	`),


	encouragement: z
		.string()
		.describe(`
		Emojis fine. Do not restate the facts action already gave.

		POSITIVE — ride the momentum. Doing a hard thing every day is already not easy, and today felt more effective than before. 
		Things are moving in a good direction. Say that and leave it there. 
		No push about next steps — they have had their encouragement for today and goal and why.

		NEGATIVE — two moves, in this order, both needed.
		First: they knew it was hard and did not quit. Most people drop it the moment it gets difficult; they are still here.
		Second: the small step. Progress may be one step, but taking it today or tomorrow already puts them past where they are standing right now — 
		because right now they are stopped. Every step after this one is progress.

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
		.nullable()
		.describe(`
			Use this only when you cannot tell WHY this matters to them, and knowing
			would change what the card should say. Null otherwise — do not ask just to
			fill the field.

			question: one gentle question inviting them to say more. A question, not a
			request that they justify themselves.

			options: two to four short tappable answers, written specifically for this
			note — not generic buckets. They should feel like plausible readings of
			their situation, so tapping one is easier than typing. A free-text box is
			always shown alongside, so the options do not need to be exhaustive.
		`),

	needs_human: z
		.boolean()
		.describe("True only for sustained hopelessness, self-harm, or anything beyond a hard day. When true, everything above is ignored."),
});

export type Checkin = z.infer<typeof CheckinSchema>;
