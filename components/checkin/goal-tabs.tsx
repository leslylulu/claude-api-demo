import { type Goal } from "@/lib/goal";

export default function GoalTabs({
	goals,
	name,
	activeId,
	onSelect,
	onAdd,
	onEdit,
}: {
	goals: Goal[];
	name: string | null;
	activeId: string;
	onSelect: (id: string) => void;
	onAdd: () => void;
	onEdit: () => void;
}) {
	const active = goals.find((g) => g.id === activeId);

	return (
		<header className="shrink-0 px-6 pt-6">
			<div className="flex items-end gap-1 overflow-x-auto">
				{goals.map((g) => (
					<button
						key={g.id}
						onClick={() => onSelect(g.id)}
						className={`max-w-56 truncate whitespace-nowrap rounded-t-lg px-3 py-2 text-sm ${
							g.id === activeId
								? "bg-(--bubble-user) text-foreground"
								: "text-(--muted) hover:text-foreground"
						}`}
					>
						{g.text.split("\n")[0]}
					</button>
				))}
				<button
					onClick={onAdd}
					aria-label="New goal"
					className="rounded-t-lg px-3 py-2 text-sm text-(--muted) hover:text-foreground"
				>
					+
				</button>
			</div>

			<div className="flex items-baseline gap-3 py-3">
				<p className="min-w-0 flex-1 truncate text-xs text-(--muted)">{active?.why || " "}</p>
				<button onClick={onEdit} className="shrink-0 text-xs text-(--muted) hover:text-foreground">
					Edit
				</button>
				{name && <span className="shrink-0 text-xs text-(--muted)">{name}</span>}
				<form action="/auth/signout" method="post" className="shrink-0">
					<button type="submit" className="text-xs text-(--muted) hover:text-foreground">
						Sign out
					</button>

				</form>
			</div>
		</header>
	);
}
