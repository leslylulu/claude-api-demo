import { TZDate } from "@date-fns/tz";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { type Entry } from "@/lib/history";


export function localDay(at: string | Date, tz: string): string {
	const date = typeof at === 'string' ? new Date(at) : at;
	return new TZDate(date, tz).toISOString().slice(0, 10);
}

export function today(tz: string): string{
	return localDay(new Date(), tz)
}


export function browserTz():string{
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function dayNumber(createdDay: string, tz: string): number{
	return differenceInCalendarDays(parseISO(today(tz)), parseISO(createdDay)) + 1;
}

export const isToday = (day: string, tz: string) => day === today(tz)

export function groupByDay(entries: Entry[]) {
	const groups: { day: string; items: Entry[] }[] = [];

	for (const entry of entries) {
		const last = groups.at(-1);
		if(last?.day === entry.day){
			last.items.push(entry)
		}else{
			groups.push({ day: entry.day, items: [entry]})
		}
	}
	return groups;
}
