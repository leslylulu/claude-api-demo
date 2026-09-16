"use client";
import { useState } from "react";
import { addGoal, deleteGoal, updateGoal, type Goal } from "@/lib/goal";

export default function GoalSetup({
	goal,
	onSaved,
	onDeleted,
	onCancel,
}: {
	goal?: Goal;
	onSaved: (g: Goal) => void;
	onDeleted?: (id: string) => void;
	onCancel?: () => void;
}) {
	const [text, setText] = useState(goal?.text ?? "");
	const [why, setWhy] = useState(goal?.why ?? "");

	const [saving, setSaving] = useState(false);
	const [confirming, setConfirming] = useState(false);

	const save = async () => {
		setSaving(true);
		const saved = goal ? await updateGoal(goal.id, { text, why }) : await addGoal(text, why);
		setSaving(false);
		if (saved) onSaved(saved);
	};

	const remove = async () => {
		if (!goal || !onDeleted) return;
		setSaving(true);
		const ok = await deleteGoal(goal.id);
		setSaving(false);
		if (ok) onDeleted(goal.id);
	};

	return (
		<div className="flex flex-col gap-6">
			<h1 className="text-xl text-foreground">
				{goal ? "Say it differently" : "What do you want?"}
			</h1>

			<textarea
				autoFocus
				rows={3}
				value={text}
				onChange={(e) => setText(e.target.value)}
				placeholder="The thing you haven’t told anyone"
				className="w-full resize-none rounded-xl border border-(--border) bg-(--bubble-user) px-4 py-3 text-foreground outline-none focus:border-(--accent)"
			/>

			<textarea
				rows={2}
				value={why}
				onChange={(e) => setWhy(e.target.value)}
				placeholder="Why do you want it? No rush — write it when it comes"
				className="w-full resize-none rounded-xl border border-(--border) bg-(--bubble-user) px-4 py-3 text-foreground outline-none focus:border-(--accent)"
			/>

			<div className="flex items-center gap-4">
				<button
					onClick={save}
					disabled={saving || !text.trim()}
					className="rounded-md bg-(--accent) px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-40"
				>
					{goal ? "Save" : "Write it down"}
				</button>
				{onCancel && (
					<button onClick={onCancel} className="text-sm text-(--muted)">
						Cancel
					</button>
				)}

				{/* Two clicks, not confirm(): deleting takes every check-in written
						under this goal with it, and that deserves a sentence. */}
				{onDeleted && (
					<div className="ml-auto">
						{confirming ? (
							<button
								onClick={remove}
								disabled={saving}
								className="text-sm text-red-600 disabled:opacity-40"
							>
								Delete this and everything written under it
							</button>
						) : (
							<button
								onClick={() => setConfirming(true)}
								className="text-sm text-(--muted) hover:text-red-600"
							>
								Delete
							</button>
						)}
					</div>
				)}
			</div>

			<p className="text-xs text-(--muted)">
				Only what you write in each check-in is sent to the AI. Everything you keep here is stored
				in your account, where nobody else can read it.
			</p>
		</div>
	);
}
