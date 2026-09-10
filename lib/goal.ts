import { createClient } from "@/lib/supabase/client";

export type Goal = {
	id: string;
	text: string;
	why: string;
	created_at: string;
};

const COLUMNS = "id, text, why, created_at";

export async function getGoals(): Promise<Goal[]> {
	const { data, error } = await createClient()
		.from("goals")
		.select(COLUMNS)
		.order("created_at", { ascending: true });

	if (error) {
		console.error(error);
		return [];
	}
	return data ?? [];
}

// No user_id anywhere in this file. The column defaults to auth.uid(), so the
// browser never gets to say whose row this is — and the RLS check would reject
// it if it tried.
export async function addGoal(text: string, why: string): Promise<Goal | null> {
	const { data, error } = await createClient()
		.from("goals")
		.insert({ text: text.trim(), why: why.trim() })
		.select(COLUMNS)
		.single();

	if (error) {
		console.error(error);
		return null;
	}
	return data;
}

export async function updateGoal(
	id: string,
	fields: { text?: string; why?: string },
): Promise<Goal | null> {
	const patch: { text?: string; why?: string } = {};
	if (fields.text !== undefined) patch.text = fields.text.trim();
	if (fields.why !== undefined) patch.why = fields.why.trim();

	const { data, error } = await createClient()
		.from("goals")
		.update(patch)
		.eq("id", id)
		.select(COLUMNS)
		.single();

	if (error) {
		console.error(error);
		return null;
	}
	return data;
}

// The check-ins go with it — `on delete cascade` in 0001_init.sql. Ask first.
export async function deleteGoal(id: string): Promise<boolean> {
	const { error } = await createClient().from("goals").delete().eq("id", id);
	if (error) {
		console.error(error);
		return false;
	}
	return true;
}
