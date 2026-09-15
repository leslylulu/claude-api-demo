import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { allow, clientIp } from "@/lib/rate-limit";
import { runCheckIn } from "@/lib/checkin-run";
import { today, dayNumber } from "@/lib/day";


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

	
	const { note, goal_id } = await req.json();

	
	if (typeof note !== "string" || !note.trim()) {
		return new Response("note is required", { status: 400 });
	}
	if (typeof goal_id !== "string" ) {
		return new Response("goal_id is required", { status: 400 });
	}

	const { data: profile } = await supabase
		.from("profiles")
		.select("timezone")
		.eq("id", user.id)
		.single()

	const tz = profile?.timezone ?? "UTC"
	const timezone = VALID_TIMEZONES.has(tz) ? tz : "UTC"

		const { data: goal } = await supabase
		.from("goals")
		.select("text, why, created_day")
		.eq("id", goal_id)
		.eq("user_id", user.id)
		.single();

	if(!goal){
		return new Response("goal not found", { status: 404 })
	}

	const [tonesRes, recentRes] = await Promise.all([
		supabase
			.from("checkins")
			.select("day, tone:result->>tone")
			.eq("goal_id", goal_id),
		// Five rows, wide column — this is the memory query. Kept separate so
		// the count never drags 300 notes across the wire.
		supabase
			.from("checkins")
			.select("day, note")
			.eq("goal_id", goal_id)
			.order("at", { ascending: false })
			.limit(5),
	]);


	const rows = (tonesRes.data ?? []) as { day: string; tone: string | null }[];

	const dayset = new Set(rows.map((r) => r.day));
	dayset.add(today(timezone));   // today's row isn't written yet — add it here
	// so "already checked in today" and "first
	// time today" need no branch

	const byTone = (t: string) =>
		new Set(rows.filter((r) => r.tone === t).map((r) => r.day)).size;

	const stats = {
		days: dayset.size,
		hardDays: byTone("negative"),
		goodDays: byTone("positive"),
		dayNumber: dayNumber(goal.created_day, timezone),
	};

	const history = (recentRes.data ?? []).slice().reverse();
	
	try {
		const response = await runCheckIn({
			goal: goal.text,
			why: goal.why,
			note,
			history,
			stats,
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
