"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { addEntry, getHistory, type Entry } from "@/lib/history";
import { type Goal } from "@/lib/goal";
import type { Checkin } from "@/lib/checkin";
import { isToday, groupByDay, browserTz } from "@/lib/day";

import CheckinCard from "./checkin-card";
import { parseISO } from "date-fns";

export default function Thread({ goal }: { goal: Goal }) {
	const router = useRouter();
	const [entries, setEntries] = useState<Entry[]>([]);
	const [note, setNote] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const newestRef = useRef<HTMLDivElement>(null);
	const [answering, setAnswering] = useState<string | null>(null);

	// Block bodies, not concise arrows: a concise arrow implicitly returns
	// whatever the expression evaluates to, and React reads an effect's return
	// value as its cleanup function.
	useEffect(() => {
		let cancelled = false;
		getHistory(goal.id).then((rows) => {
			if (!cancelled) setEntries(rows);
		});
		return () => {
			cancelled = true;
		};
	}, [goal.id]);

	// getHistory() is chronological, so the fresh end of the thread is the
	// BOTTOM. This ref is coupled to that ordering — flip the sort and it has to
	// move with it, or submitting scrolls away from what you just wrote.
	useEffect(() => {
		newestRef.current?.scrollIntoView();
	}, [entries, pending, answering]);

	const submit = async () => {
		if (pending || !note.trim()) return;
		setPending(true);
		setError("");

		try {
			const res = await fetch("/api/checkin", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					note,
					goal_id: goal.id,
				}),
			});
			if (res.status === 401) {
				router.push("/login");
				return;
			}
			if (!res.ok) throw new Error(await res.text());

			const result: Checkin = await res.json();
			setEntries(await addEntry(goal.id, note, result));
			setNote("");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
		} finally {
			setPending(false);
		}
	};

	const answer = async (entry: Entry, text: string) => {
		if (pending || answering) return;
		setAnswering(entry.id);
		setError("");

		try {
			const res = await fetch("/api/checkin", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					note: text,
					goal_id: goal.id,
				}),
			});
			if (res.status === 401) {
				router.push("/login");
				return;
			}
			if (!res.ok) throw new Error(await res.text());

			const result: Checkin = await res.json();
			setEntries(await addEntry(goal.id, text, result));
		} catch (err) {
			setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
		} finally {
			setAnswering(null);
		}
	};

	const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.nativeEvent.isComposing) return; // IME preedit
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
	};

	const tz = browserTz();

	return (
		<>
			<div className="flex-1 overflow-y-auto px-6 py-8">
				<div className="relative">
					<div aria-hidden className="absolute bottom-2 left-0 top-2 w-px bg-(--border)" />

					<div className="pl-2">
						{entries.length === 0 && (
							<p className="text-sm text-(--muted)">Nothing here yet. How is it going?</p>
						)}

						{groupByDay(entries).map((group) => {
							const current = isToday(group.day, tz);
							return (
								<section key={group.day} className="mt-12 space-y-4 first:mt-0 ">
									<DayMarker day={group.day} today={current} />
									{group.items.map((entry) => {
										const isLast = entry.id === entries.at(-1)?.id;
										return (
											<CheckinCard
												key={entry.id}
												note={entry.note}
												result={entry.result}
												today={current}
												onAnswer={isLast ? (text) => answer(entry, text) : undefined}
												answering={answering === entry.id}
											/>
										);
									})}
								</section>
							);
						})}

						{(pending || answering) && <p className="mt-6 text-sm text-(--muted)">……</p>}
						{error && <p className="mt-6 text-sm text-red-500">{error}</p>}
						<div ref={newestRef} />
					</div>
				</div>
			</div>

			<div className="flex shrink-0 flex-col gap-2 px-6 pb-8">
				<textarea
					autoFocus
					rows={2}
					value={note}
					onChange={(e) => setNote(e.target.value)}
					onKeyDown={onKeyDown}
					placeholder="How was today?"
					className="w-full resize-none rounded-xl border border-(--border) bg-(--bubble-user) px-4 py-3 text-foreground outline-none focus:border-(--accent)"
				/>
				<div className="flex items-center justify-end gap-3">
					<span className="text-xs text-(--muted)">
						Claude is AI and can make mistakes. Please double-check responses.
					</span>
					<button
						onClick={submit}
						disabled={pending || !note.trim()}
						className="rounded-md bg-(--accent) px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-40"
					>
						{pending ? "…" : "Send"}
					</button>
				</div>
			</div>
		</>
	);
}

function DayMarker({ day, today }: { day: string; today: boolean }) {
	return (
		<div className={`relative text-sm ${today ? "font-medium text-foreground" : "text-(--muted)"}`}>
			<span
				aria-hidden
				className={`absolute -left-2 top-1.5 h-2 w-2 -translate-x-1/2 rounded-full ring-4 ring-background ${
					today ? "bg-(--accent)" : "bg-(--border)"
				}`}
			/>
			{today
				? "Today"
				: parseISO(day).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
		</div>
	);
}
