

const SEEDS = [
	// ---- self-blame ----
	{
		text: "Stop putting yourself on trial for something that has already happened. You don’t have to keep hurting yourself to prove that you’re sorry.",
		source: null,
		feelings: ["self_blame"],
	},
	{
		text: "Regret is meant to teach you, not punish you.",
		source: null,
		feelings: ["self_blame"],
	},
	{
		text: "Take responsibility, not permanent blame.",
		source: null,
		feelings: ["self_blame"],
	},
	{
		text: "You can own your mistake without becoming your mistake.",
		source: null,
		feelings: ["self_blame"],
	},
	{
		text: "You don’t have to suffer forever for something you wish you had done differently.",
		source: null,
		feelings: ["self_blame"],
	},
	{
		text: "You can’t change what happened. You can change what happens next.",
		source: null,
		feelings: ["self_blame", "stuck"],
	},

	// ---- anxious ----
	{
		text: "Anxiety is like the weather. There will be cloudy days, and there will be sunny ones.",
		source: null,
		feelings: ["anxious"],
	},
	{
		text: "Allow yourself to feel bad right now. You don’t have to fight it or force yourself to feel better.",
		source: null,
		feelings: ["anxious", "drained"],
	},
	{
		text: "Expressive writing can help clear anxious thoughts from your mind, allowing you to focus more fully on the challenge in front of you and handle it more effectively.",
		source: null,
		feelings: ["anxious"],
	},
	{
		text: "Sometimes the struggle comes from seeing the shape of the life you want so clearly, while knowing you haven’t yet earned your way there. It’s that strange feeling of being close enough to see it, yet still feeling like it’s just out of reach.",
		source: null,
		feelings: ["anxious", "stuck"],
	},
	{
		text: "You are allowed to make mistakes. You are allowed to be uncertain. You are allowed to do something without knowing exactly how it will turn out.",
		source: null,
		feelings: ["anxious", "avoidant"],
	},
	{
		text: "Come back to today. Deal with what is real, not everything your mind is imagining.",
		source: null,
		feelings: ["anxious"],
	},
	{
		text: "You are trying to prepare for every possible disaster. But what if you trusted yourself to handle things as they come?",
		source: null,
		feelings: ["anxious"],
	},
	{
		text: "Uncertainty feels scary because you want an answer right now.",
		source: null,
		feelings: ["anxious", "stuck"],
	},
	{
		text: "Your anxious thoughts are trying to protect you by showing you everything that could go wrong.",
		source: null,
		feelings: ["anxious"],
	},
	{
		text: "You don’t know what’s going to happen. But you know you can handle it.",
		source: null,
		feelings: ["anxious"],
	},
	{
		text: "You’ve handled hard things before. You’ll handle this too.",
		source: null,
		feelings: ["anxious", "drained"],
	},
	{
		text: "You can’t control what’s coming. You can control how you meet it.",
		source: null,
		feelings: ["anxious"],
	},
	{
		text: "Your fear is loud. That doesn’t mean it’s right.",
		source: null,
		feelings: ["anxious", "avoidant"],
	},
	{
		text: "You can be uncertain and still be strong.",
		source: null,
		feelings: ["anxious"],
	},

	// ---- drained ----
	{
		text: "Hey. You’re exhausted. Stop pushing for a minute.",
		source: null,
		feelings: ["drained"],
	},
	{
		text: "Get some coffee. Take a nap. Order the food. Have the dessert.",
		source: null,
		feelings: ["drained"],
	},
	{
		text: "You don’t need to be productive today. You need to recharge.",
		source: null,
		feelings: ["drained"],
	},
	{
		text: "Your body is asking for a break. Listen to it.",
		source: null,
		feelings: ["drained"],
	},
	{
		text: "Rest isn’t laziness. You’re running on empty.",
		source: null,
		feelings: ["drained", "self_blame"],
	},
	{
		text: "You’re allowed to take a break without feeling guilty.",
		source: null,
		feelings: ["drained", "self_blame"],
	},
	{
		text: "You can rest before you’re completely burned out.",
		source: null,
		feelings: ["drained"],
	},
	{
		text: "Sometimes the most productive thing you can do is rest.",
		source: null,
		feelings: ["drained"],
	},
	{
		text: "You don’t need to push through everything.",
		source: null,
		feelings: ["drained"],
	},

	// ---- avoidant ----
	{
		text: "You’re not lazy. You’re avoiding something that feels uncomfortable.",
		source: null,
		feelings: ["avoidant", "self_blame"],
	},
	{
		text: "What if you fail? You’ll learn something you couldn’t have learned by staying still.",
		source: null,
		feelings: ["avoidant"],
	},
	{
		text: "Don’t think about the whole thing. What’s the smallest thing you can do?",
		source: null,
		feelings: ["avoidant", "stuck"],
	},
	{
		text: "You don’t need a guarantee. You just need a chance.",
		source: null,
		feelings: ["avoidant"],
	},
	{
		text: "You can’t fail at something you never gave yourself permission to try.",
		source: null,
		feelings: ["avoidant"],
	},
	{
		text: "Trying and failing is still better than spending forever wondering, “What if?”",
		source: null,
		feelings: ["avoidant"],
	},
	{
		text: "You’re not supposed to be good at something before you’ve practiced it.",
		source: null,
		feelings: ["avoidant", "self_blame"],
	},
	{
		text: "You can survive getting it wrong.",
		source: null,
		feelings: ["avoidant"],
	},
	{
		text: "Not everything has to pay off to be worth your time.",
		source: null,
		feelings: ["avoidant"],
	},
	{
		text: "You’re not wasting time just because the outcome isn’t guaranteed.",
		source: null,
		feelings: ["avoidant"],
	},
	{
		text: "You’ll never know if it’s worth your time until you give it some time.",
		source: null,
		feelings: ["avoidant"],
	},
	{
		text: "And if it doesn’t work? You’ll know more than you know right now. That’s not wasted time.",
		source: null,
		feelings: ["avoidant"],
	},

	// ---- stuck ----
	{
		text: "Stop trying to solve everything at once.",
		source: null,
		feelings: ["stuck", "anxious"],
	},
	{
		text: "When everything feels overwhelming, make it smaller.",
		source: null,
		feelings: ["stuck", "anxious"],
	},
	{
		text: "One step is still movement.",
		source: null,
		feelings: ["stuck", "steady"],
	},
	{
		text: "You can figure it out as you go.",
		source: null,
		feelings: ["stuck"],
	},
	{
		text: "Clarity often comes after action, not before it.",
		source: null,
		feelings: ["stuck", "avoidant"],
	},
	{
		text: "Start messy. Adjust later.",
		source: null,
		feelings: ["stuck", "avoidant"],
	},
	{
		text: "Don't wait for clarity to arrive. Create it by moving.",
		source: null,
		feelings: ["stuck"],
	},
	{
		text: "The goal isn't to get unstuck all at once. It's to move one inch.",
		source: null,
		feelings: ["stuck"],
	},
	{
		text: "You don't need to know what comes next five years from now.",
		source: null,
		feelings: ["stuck", "anxious"],
	},
	{
		text: "Just figure out what feels worth trying next.",
		source: null,
		feelings: ["stuck"],
	},
	{
		text: "You don't need certainty. You need somewhere to begin.",
		source: null,
		feelings: ["stuck", "anxious"],
	},
	{
		text: "You don't have to figure it out before you start. You can figure it out by starting.",
		source: null,
		feelings: ["stuck", "avoidant"],
	},

	// ---- steady ----
	{
		text: "You don't have to destroy your stability to grow.",
		source: null,
		feelings: ["steady"],
	},
	{
		text: "You don't have to rush just because everyone else is moving.",
		source: null,
		feelings: ["steady", "anxious"],
	},
	{
		text: "Small progress, repeated often, can take you further than occasional bursts of motivation.",
		source: null,
		feelings: ["steady"],
	},
	{
		text: "Just because you can't see the change yet doesn't mean nothing is happening.",
		source: null,
		feelings: ["steady", "drained"],
	},
	{
		text: "Your pace doesn't need to look impressive to be meaningful.",
		source: null,
		feelings: ["steady"],
	},
	{
		text: "Slow progress is still progress.",
		source: null,
		feelings: ["steady"],
	},
	{
		text: "Not every season is meant for rapid growth.",
		source: null,
		feelings: ["steady", "drained"],
	},
	{
		text: "Some seasons are not for blooming. They’re for putting down roots.",
		source: null,
		feelings: ["steady", "drained"],
	},
	{
		text: "You don’t always have to grow upward. Sometimes, growth means growing deeper.",
		source: null,
		feelings: ["steady"],
	},
	{
		text: "You’re seeing their results, not their roots.",
		source: null,
		feelings: ["comparison"],
	},

	{
		text: "You’re comparing your behind the scenes to someone else’s highlight reel.",
		source: null,
		feelings: ["anxious", "self_blame"],
	},
	{
		text: "You don’t see the late nights, the failures, or the years of work behind someone’s success.",
		source: null,
		feelings: ["anxious", "self_blame"],
	},

	{
		text: "Don’t compare your beginning to someone else’s chapter twenty.",
		source: null,
		feelings: ["anxious", "self_blame"],
	},
	{
		text: "You’re not behind. You’re just seeing someone else’s finished chapter.",
		source: null,
		feelings: ["anxious", "self_blame"],
	},
	{
		text: "Their success may look sudden from the outside. It probably wasn’t.",
		source: null,
		feelings: ["anxious"],
	},
	{
		text: "Keep going. The part you’re building now may be the part nobody sees yet.",
		source: null,
		feelings: ["steady", "anxious"],
	},
] as const;

type Seed = (typeof SEEDS)[number];
export type Quote = Seed & { id: string };


function hashId(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36).padStart(7, "0");
}

export const QUOTES: Quote[] = SEEDS.map((seed) => ({ ...seed, id: hashId(seed.text) }));

if (new Set(QUOTES.map((q) => q.id)).size !== QUOTES.length) {
	throw new Error("quotes.ts: duplicate id — two lines hash the same, reword one");
}

// The model can only choose an id that actually exists.
export const QUOTE_IDS = QUOTES.map((q) => q.id) as [string, ...string[]];

export const quoteById = (id: string | null): Quote | undefined =>
	id ? QUOTES.find((q) => q.id === id) : undefined;

export const QUOTE_CATALOG = QUOTES.map(
	(q) => `${q.id} [${q.feelings.join(",")}] ${q.text}`,
).join("\n");
