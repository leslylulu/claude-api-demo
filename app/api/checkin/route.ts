import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { allow, clientIp } from "@/lib/rate-limit";
import { runCheckIn } from "@/lib/checkin-run";


const LIMIT = 20;
const WINDOW_MS = 60 * 60 * 1000;
const VALID_TIMEZONES = new Set(Intl.supportedValuesOf("timeZone"));

// Vercel's default is already 300s, so this lowers the ceiling rather than
// raising it. The route runs ~7s; 60 leaves room for a slow upstream without
// letting a stuck request sit on a slot for five minutes.
export const maxDuration = 60;

export async function POST(req: Request) {
	if (!allow(`ip:${clientIp(req)}`, LIMIT * 3, WINDOW_MS)) {
		return new Response("Too many check-ins. Try again later.", { status: 429 });
	}

	const supabase = createClient(await cookies());

	const { data: { user }, error: authError } = await supabase.auth.getUser();

	if (authError || !user) {
		return new Response("Sign in First", { status: 401 })
	}

	if (!allow(`user:${user.id}`, LIMIT, WINDOW_MS)) {
		return new Response("Too many check-ins. Try again later.", { status: 429 });
	}

	
	const { note, goal_id, tz } = await req.json();

	const timezone =
		typeof tz === "string" && VALID_TIMEZONES.has(tz) ? tz : "UTC";

	if (typeof note !== "string" || !note.trim()) {
		return new Response("note is required", { status: 400 });
	}
	if (typeof goal_id !== "string" ) {
		return new Response("goal_id is required", { status: 400 });
	}

		const { data: goal } = await supabase
		.from("goals")
		.select("text, why")
		.eq("id", goal_id)
		.eq("user_id", user.id)
		.single();

	if(!goal){
		return new Response("goal not found", { status: 404 })
	}

	const [recentRes, totalRes, hardRes, firstRes] = await Promise.all([
		supabase
			.from("checkins")
			.select("at, note")
			.eq("goal_id", goal_id)
			.order("at", { ascending: false })
			.limit(5),
		supabase
			.from("checkins")
			.select("*", { count: "exact", head: true })
			.eq("goal_id", goal_id),
		supabase
			.from("checkins")
			.select("*", { count: "exact", head: true })
			.eq("goal_id", goal_id)
			.eq("result->>tone", "negative"),
		supabase
			.from("checkins")
			.select("at")
			.eq("goal_id", goal_id)
			.order("at", { ascending: true })
			.limit(1)
			.maybeSingle(),
	]);

	const history = (recentRes.data ?? []).slice().reverse();

	const stats = {
		hard: hardRes.count ?? 0,
		firstAt: firstRes.data?.at ?? null,
	};

	try {
		const response = await runCheckIn({
			goal: goal.text,
			why: goal.why,
			note,
			history,
			stats,
			timezone
		})

		// console.log(JSON.stringify(response.content, null, 2));
		// console.log('usage === ', response.usage);
		if (!response.parsed_output) {
			return new Response("Could not parse the response", { status: 502 });
		}
		return Response.json(response.parsed_output);
	} catch (err) {
		console.error("checkin failed:", err);
		const message =
			err instanceof Anthropic.APIError
				? `${err.status}: ${(err.error as { error?: { message?: string } })?.error?.message ?? err.message}`
				: "Upstream request failed.";
		return new Response(message, { status: 502 });
	}
}
