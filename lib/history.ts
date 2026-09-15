import { createClient } from "@/lib/supabase/client";
import type { Checkin } from "./checkin";
import { browserTz, today } from "./day";

export type Entry = {
	id: string;
	at: string;
	day: string;
	goal_id: string;
	note: string;
	result: Checkin;
};

const COLUMNS = "id, at, day, goal_id, note, result";

// Chronological, oldest first — the page scrolls to the bottom.
export async function getHistory(goalId: string): Promise<Entry[]> {
	// RLS narrows this to your rows; `eq` narrows it to this goal. Two different
	// filters — the first is a security boundary, the second is the query.
	const { data, error } = await createClient()
		.from("checkins")
		.select(COLUMNS)
		.eq("goal_id", goalId)
		.order("day", {ascending: true })
		.order("at", { ascending: true });

	if (error) {
		console.error(error);
		return [];
	}
	return (data ?? []) as Entry[];
}

export async function addEntry(goalId: string, note: string, result: Checkin): Promise<Entry[]> {
	const tz = browserTz();
	const { error } = await createClient()
		.from("checkins")
		.insert({ 
			goal_id: goalId, 
			note, 
			result,
			tz,
			day: today(tz)
		});

	if (error) console.error(error);
	return getHistory(goalId);
}


