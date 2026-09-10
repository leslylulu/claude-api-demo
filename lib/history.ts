import { createClient } from "@/lib/supabase/client";
import type { Checkin } from "./checkin";

export type Entry = {
	id: string;
	at: string;
	goal_id: string;
	note: string;
	result: Checkin;
};

const COLUMNS = "id, at, goal_id, note, result";

// Chronological, oldest first — the page scrolls to the bottom.
export async function getHistory(goalId: string): Promise<Entry[]> {
	// RLS narrows this to your rows; `eq` narrows it to this goal. Two different
	// filters — the first is a security boundary, the second is the query.
	const { data, error } = await createClient()
		.from("checkins")
		.select(COLUMNS)
		.eq("goal_id", goalId)
		.order("at", { ascending: true });

	if (error) {
		console.error(error);
		return [];
	}
	return (data ?? []) as Entry[];
}

export async function addEntry(goalId: string, note: string, result: Checkin): Promise<Entry[]> {
	const { error } = await createClient()
		.from("checkins")
		.insert({ goal_id: goalId, note, result });

	if (error) console.error(error);
	return getHistory(goalId);
}

// Delete, but no update: a check-in is a record of a moment. Editing one would
// let you rewrite how a day went, which is the opposite of what this is for.
export async function deleteEntry(id: string, goalId: string): Promise<Entry[]> {
	const { error } = await createClient().from("checkins").delete().eq("id", id);
	if (error) console.error(error);
	return getHistory(goalId);
}
