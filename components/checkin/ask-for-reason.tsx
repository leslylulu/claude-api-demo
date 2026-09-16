import { useState } from "react";

import type { Checkin } from "@/lib/checkin";

export default function AskForReason({
	ask,
	onAnswer,
	pending,
}: {
	ask: NonNullable<Checkin["ask_for_reason"]>;
	onAnswer?: (text: string) => void;
	pending: boolean;
}) {
	const [custom, setCustom] = useState("");

	const send = (text: string) => {
		const t = text.trim();
		if (!t || pending || !onAnswer) return;
		onAnswer(t);
	};

	const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.nativeEvent.isComposing) return; // IME preedit
		// Shift+Enter = newline
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			send(custom);
		}
	};

	return (
		// fieldset for disabled input and button insides
		<fieldset disabled={pending} className="flex flex-col mt-3 gap-3">
			<legend className="text-sm text-foreground mb-3">{ask.question}</legend>
			<div className="flex flex-col gap-2">
				{
					// type='button' in fieldset is submit by default
					ask.options.map((item, index) => (
						<button
							className="rounded-md border border-(--border) px-3 py-1.5 text-sm text-foreground hover:border-(--accent) disabled:opacity-40"
							key={index}
							onClick={() => send(item)}
							type="button"
						>
							{item}
						</button>
					))
				}
			</div>
			<input
				value={custom}
				onKeyDown={onKeyDown}
				onChange={(e) => setCustom(e.target.value)}
				placeholder="Or Other Thoughts?"
				className="w-full rounded-xl border border-(--border) bg-(--bubble-user) px-4 py-3 text-foreground outline-none focus:border-(--accent)"
			/>
		</fieldset>
	);
}
