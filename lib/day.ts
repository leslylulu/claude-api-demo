import { type Entry } from "@/lib/history";

const isToday = (at: string) => new Date(at).toDateString() === new Date().toDateString();


function groupByDay(entries: Entry[]) {
	const groups: { key: string; at: string; items: Entry[] }[] = [];
	for (const entry of entries) {
		const key = new Date(entry.at).toDateString();
		const last = groups.at(-1);
		if (last?.key === key) last.items.push(entry);
		else groups.push({ key, at: entry.at, items: [entry] });
	}
	return groups;
}

export { isToday, groupByDay}