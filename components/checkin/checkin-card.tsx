import type { Checkin } from "@/lib/checkin";
import AskForReason from "./ask-for-reason";

export default function CheckinCard({
	note,
	result: c,
	onAnswer,
	answering,
}: {
	note: string;
	result: Checkin;
	today: boolean;
	onAnswer?: (text: string) => void;
	answering?: boolean;
}) {
	if (c.needs_human) {
		return (
			/* No red border: a card that looks like an error makes the person feel
				 flagged, and this branch is the opposite of alarm. */
			<section className="flex flex-col gap-3 rounded-xl border border-(--border) p-5">
				<Note>{note}</Note>
				{c.emotion && <p className="text-foreground">{c.emotion}</p>}
				<p className="text-foreground">What you’re describing is past what I can help with.</p>
				<p className="text-foreground">
					Talk to someone real — a friend you trust, a group that meets in person, or a
					professional. Not because something is wrong with you. Some things need a person, not an
					app.
				</p>
				{/* TODO: region-appropriate crisis lines would be better than this, but
						a wrong or dead number is worse than none — check any by hand rather
						than generating them. Not a blocker: pointing at real people already
						does the one thing that matters, which is to stop encouraging. */}
			</section>
		);
	}

	return (
		<section className={`flex flex-col gap-4 rounded-xl p-5`}>
			<Note>{note}</Note>
			{(c.emotion || c.action) && (
				<div className="bg-purple-800/10 p-4 rounded-lg flex flex-col gap-4 ">
					{c.emotion && <p className="text-gray-600 text-sm">{c.emotion}</p>}

					{c.action && (
						<blockquote className="border-l-2 border-(--accent) pl-4 text-lg text-foreground">
							{c.action}
						</blockquote>
					)}
					{c.encouragement && <p className="text-sm text-(--muted)">❤️{c.encouragement}</p>}
				</div>
			)}
			{c.ask_for_reason && onAnswer && (
				<AskForReason ask={c.ask_for_reason} onAnswer={onAnswer} pending={!!answering} />
			)}
		</section>
	);
}

function Note({ children }: { children: string }) {
	return (
		<p className="whitespace-pre-wrap text-right text-sm text-(--muted)">
			<strong className="text-lg font-extrabold text-black mr-1.5 font-serif">Q:</strong>
			{children}
		</p>
	);
}
