"use client";
import { useEffect, useRef, useState } from "react";
import type { Checkin } from "@/lib/checkin";
import { quoteById } from "@/lib/quotes";
import { addGoal, getGoals, type Goal } from "@/lib/goal";
import { addEntry, getHistory, type Entry } from "@/lib/history";

export default function CheckinPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // localStorage can't be read during render (the server has no window), so the
  // first paint is deliberately empty rather than briefly wrong.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const gs = getGoals();
    setGoals(gs);
    setActiveId(gs[0]?.id ?? null);
    setLoaded(true);
  }, []);

  const onCreated = (g: Goal) => {
    setGoals((prev) => [...prev, g]);
    setActiveId(g.id);
    setAdding(false);
  };

  if (!loaded) return null;

  const active = goals.find((g) => g.id === activeId);

  if (!active || adding) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-6 py-16">
        <GoalSetup
          onCreated={onCreated}
          onCancel={goals.length ? () => setAdding(false) : undefined}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-dvh w-full max-w-2xl flex-col">
      <Tabs goals={goals} activeId={active.id} onSelect={setActiveId} onAdd={() => setAdding(true)} />
      {/* key remounts the thread when the tab changes, so scroll position and in-flight state don't leak between goals */}
      <Thread key={active.id} goal={active} />
    </main>
  );
}


function GoalSetup({
  onCreated,
  onCancel,
}: {
  onCreated: (g: Goal) => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const [why, setWhy] = useState("");

  const save = () => {
    const g = addGoal(text, why);
    if (g) onCreated(g);
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl text-foreground">What do you want?</h1>

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
          disabled={!text.trim()}
          className="rounded-md bg-(--accent) px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Write it down
        </button>
        {onCancel && (
          <button onClick={onCancel} className="text-sm text-(--muted)">
            Cancel
          </button>
        )}
      </div>

      <p className="text-xs text-(--muted)">
        Only what you write in each check-in is sent to the AI. Your goals and
        everything you keep here stay in this browser.
      </p>
    </div>
  );
}

// One goal, one tab. The name is the tab, the reason is its subtitle — which is
// why no card in the thread below repeats either of them.
function Tabs({
  goals,
  activeId,
  onSelect,
  onAdd,
}: {
  goals: Goal[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
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

      <p className="truncate py-3 text-xs text-(--muted)">{active?.why || " "}</p>
    </header>
  );
}

function Thread({ goal }: { goal: Goal }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const newestRef = useRef<HTMLDivElement>(null);

  // Block bodies, not concise arrows: a concise arrow implicitly returns
  // whatever the expression evaluates to, and React reads an effect's return
  // value as its cleanup function.
  useEffect(() => {
    setEntries(getHistory(goal.id))
  }, [goal.id]);

  // getHistory() is chronological, so the fresh end of the thread is the
  // BOTTOM. This ref is coupled to that ordering — flip the sort and it has to
  // move with it, or submitting scrolls away from what you just wrote.
  useEffect(() => {
    newestRef.current?.scrollIntoView();
  }, [entries, pending]);

  const submit = async () => {
    if (pending || !note.trim()) return;
    setPending(true);
    setError("");

    try {
      const res = await fetch("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, goal: goal.text, why: goal.why }),
      });
      if (!res.ok) throw new Error(await res.text());

      const result: Checkin = await res.json();
      setEntries(addEntry(goal.id, note, result));
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return; // IME preedit
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto px-6 py-8">

        <div className="relative">
          <div
            aria-hidden
            className="absolute bottom-2 left-0 top-2 w-px bg-(--border)"
          />

          <div className="pl-2">
            {entries.length === 0 && (
              <p className="text-sm text-(--muted)">Nothing here yet. How is it going?</p>
            )}

            {groupByDay(entries).map((group) => {
              const today = isToday(group.at);
              return (
                <section key={group.key} className="mt-12 space-y-4 first:mt-0 ">
                  <DayMarker at={group.at} today={today} />
                  {group.items.map((entry) => (
                    <Card key={entry.at} note={entry.note} result={entry.result} today={today} />
                  ))}
                </section>
              );
            })}

            {pending && <p className="mt-6 text-sm text-(--muted)">…</p>}
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
          <span className="text-xs text-(--muted)">Enter to send · Shift+Enter for a new line</span>
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


function DayMarker({ at, today }: { at: string; today: boolean }) {
  return (
    <div
      className={`relative text-sm ${
        today ? "font-medium text-foreground" : "text-(--muted)"
      }`}
    >
      <span
        aria-hidden
        className={`absolute -left-2 top-1.5 h-2 w-2 -translate-x-1/2 rounded-full ring-4 ring-(--background) ${
          today ? "bg-(--accent)" : "bg-(--border)"
        }`}
      />
      {today
        ? "Today"
        : new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
    </div>
  );
}


function Card({
  note,
  result: c,
  today,
}: {
  note: string;
  result: Checkin;
  today: boolean;
}) {
  if (c.needs_human) {
    return (
      <section className="flex flex-col gap-3 rounded-xl border border-red-500/40 p-5">
        <Note>{note}</Note>
        {c.separation && <p className="text-foreground">{c.separation}</p>}
        <p className="text-foreground">
          What you’re describing is beyond what I can help with, and it deserves
          to be taken more seriously than I can take it. Talking to a real person
          would matter more than anything I can say here.
        </p>
        {/* TODO — BLOCKS DEPLOY: put verified, region-appropriate crisis
            resources here. A wrong or dead number is worse than none, so this
            must be checked by hand, not generated. */}
      </section>
    );
  }

  const attribution = c.line ? quoteById(c.line.based_on)?.source : undefined;

  return (
    <section
      className={`flex flex-col gap-4 rounded-xl p-5`}
    >
      <Note>{note}</Note>
      <div className="bg-purple-800/10 p-4 rounded-lg flex flex-col gap-4 ">
        {c.separation && <p className="text-gray-600 text-sm">{c.separation}</p>}

        {c.line && (
          <blockquote className="border-l-2 border-(--accent) pl-4 text-lg text-foreground">
            {c.line.text}
            {attribution && (
              <footer className="mt-1 text-xs text-(--muted)">— {attribution}</footer>
            )}
          </blockquote>
        )}
        <p className="text-sm text-(--muted)">{c.capability}</p>
      </div>

      {c.ask_for_reason && <p className="text-sm text-(--muted)">{c.ask_for_reason}</p>}
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
