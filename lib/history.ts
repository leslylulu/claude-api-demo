import type { Checkin } from "./checkin";



export type Entry = {
	at: string;
	goal_id: string;
	note: string;
	result: Checkin;
};

const KEY = "checkins";

function readAll(): Entry[] {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return [];
		const all = JSON.parse(raw) as Entry[];
		// Entries written before goals had ids belong to the migrated goal.
		return all.map((e) => (e.goal_id ? e : { ...e, goal_id: "legacy" }));
	} catch {
		return [];
	}
}


export const getHistory = (goalId: string): Entry[] =>
	readAll().filter((e) => e.goal_id === goalId);

export function addEntry(goalId: string, note: string, result: Checkin): Entry[] {
	const entry: Entry = { at: new Date().toISOString(), goal_id: goalId, note, result };
	try {
		localStorage.setItem(KEY, JSON.stringify([...readAll(), entry]));
	} catch {
		// Storage full or blocked — the card still renders, it just isn't kept.
	}
	return getHistory(goalId);
}
