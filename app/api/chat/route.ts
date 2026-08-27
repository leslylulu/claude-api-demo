import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function POST(req: Request) {
	const { messages } = await req.json();

	const res = await client.messages.create({
		model: "claude-sonnet-4-6",
		max_tokens: 1024, // limit for AI's response, normally 1024 is enough for most cases
		temperature: 0.5, // 0 means deterministic, 1 means random, no randomness
		system: "You are a helpful assistant.",
		messages: [{ role: "user", content: messages }]
	});

	// IDEA
	// system prompt: is the instruction that you give to the AI to set the context of the conversation.
	// It can be used to define the AI's behavior, personality, or any specific instructions you want it to follow.

	// what does it do?
	// who you are: it defines the AI's role and purpose in the conversation.
	// constraints output format: only json? NO text? no MD?
	// set scope of conversation: it can limit the AI's responses to a specific topic or domain.
	// control tone and style: it can influence the AI's tone, style, and level of formality in its responses.
	// provide context for the conversation:  like imagine you are a travel agent, you can provide context about the user's travel preferences, budget, and destination to help the AI generate more relevant responses.


	// comment
	// key points:
	// 1. effect on whole conversation: the system prompt is applied to the entire conversation, not just a single message.


	//* how to use system prompt effectively:
	// 1. be specific and clear
	// 2. do what you should do  is better than what you shouldn't do 
	// 3 use structured format: 
	// 	bullet points, 
	// 	numbered lists, or 
	//  tables to organize the instructions and 
	// 	make them easier for the AI to follow.




	


	const text = res.content.filter((item) => item.type === "text").map((item) => item.text).join("");


	return Response.json({ text });
}