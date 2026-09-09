export type Goal = {
	id: string;
	text: string;
	why: string;
	created_at: string;
};

const KEY = "goals";
const LEGACY_KEY = "goal"; 

export function getGoals(): Goal[] {
	try {
		const raw = localStorage.getItem(KEY);
		if (raw) return JSON.parse(raw) as Goal[];

		
		const legacy = localStorage.getItem(LEGACY_KEY);
		if (!legacy) return [];
		const g = JSON.parse(legacy) as Omit<Goal, "id">;
		const migrated: Goal[] = [{ ...g, id: "legacy" }];
		localStorage.setItem(KEY, JSON.stringify(migrated));
		return migrated;
	} catch {
		return [];
	}
}

export function addGoal(text: string, why: string): Goal | null {
	const goal: Goal = {
		id: crypto.randomUUID(),
		text: text.trim(),
		why: why.trim(),
		created_at: new Date().toISOString(),
	};
	try {
		localStorage.setItem(KEY, JSON.stringify([...getGoals(), goal]));
		return goal;
	} catch {
		return null;
	}
}
