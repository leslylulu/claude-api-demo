import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function POST(req: Request) {
	const { messages } = await req.json();

	const res = await client.messages.create({
		model: "claude-sonnet-4-6",
		max_tokens: 1024, // limit for AI's response, normally 1024 is enough for most cases
		messages: [{ role: "user", content: messages }]
	});


	const text = res.content.filter((item) => item.type === "text").map((item) => item.text).join("");


	return Response.json({ text });
}