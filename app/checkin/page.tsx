"use client";
import { useEffect, useRef, useState } from "react";
import type { Checkin } from "@/lib/checkin";
import { quoteById } from "@/lib/quotes";
import { addGoal, deleteGoal, getGoals, updateGoal, type Goal } from "@/lib/goal";
import { addEntry, getHistory, type Entry } from "@/lib/history";
import { useRouter } from 'next/navigation';
import { createClient } from "@/lib/supabase/client"

export default function CheckinPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [email, setEmail] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  // The goals live in Postgres now, so the first paint has nothing to show yet.
  // Deliberately empty rather than briefly wrong.
  const [loaded, setLoaded] = useState(false);
  
  useEffect(() => {
    let cancelled = false;

    createClient().auth.getUser().then(({data}) => {
      if(!cancelled){
        setEmail(data.user?.email ?? null)
      }
    })
      
    getGoals().then((gs) => {
      if (cancelled) return;
      setGoals(gs);
      setActiveId(gs[0]?.id ?? null);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onCreated = (g: Goal) => {
    setGoals((prev) => [...prev, g]);
    setActiveId(g.id);
    setAdding(false);
  };

  const onUpdated = (g: Goal) => {
    setGoals((prev) => prev.map((x) => (x.id === g.id ? g : x)));
    setEditing(false);
  };

  const onDeleted = (id: string) => {
    setGoals((prev) => {
      const left = prev.filter((g) => g.id !== id);
      setActiveId(left[0]?.id ?? null);
      return left;
    });
    setEditing(false);
  };

  if (!loaded) return null;

  const active = goals.find((g) => g.id === activeId);

  if (!active || adding || editing) {
    const target = editing ? active : undefined;
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-6 py-16">
        <GoalSetup
          key={target?.id ?? "new"}
          goal={target}
          onSaved={target ? onUpdated : onCreated}
          onDeleted={target ? onDeleted : undefined}
          onCancel={
            goals.length ? () => (editing ? setEditing(false) : setAdding(false)) : undefined
          }
        />
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-dvh w-full max-w-2xl flex-col">
      <Tabs
        goals={goals}
        name={ email?.split('@')[0] ?? null }
        activeId={active.id}
        onSelect={setActiveId}
        onAdd={() => setAdding(true)}
        onEdit={() => setEditing(true)}
      />
      {/* key remounts the thread when the tab changes, so scroll position and in-flight state don't leak between goals */}
      <Thread key={active.id} goal={active} />
    </main>
  );
}


// Doubles as the editor. `goal` present means editing an existing one — the
// fields, the heading and the destructive action all follow from that.
function GoalSetup({
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
        Only what you write in each check-in is sent to the AI. Everything you
        keep here is stored in your account, where nobody else can read it.
      </p>
    </div>
  );
}

// One goal, one tab. The name is the tab, the reason is its subtitle — which is
// why no card in the thread below repeats either of them.
function Tabs({
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

function Thread({ goal }: { goal: Goal }) {
  const router = useRouter()
  const [entries, setEntries] = useState<Entry[]>([]);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const newestRef = useRef<HTMLDivElement>(null);

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
      if(res.status === 401){
        router.push("/login")
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
          <span className="text-xs text-(--muted)">Claude is AI and can make mistakes. Please double-check responses.</span>
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
      /* No red border: a card that looks like an error makes the person feel
         flagged, and this branch is the opposite of alarm. */
      <section className="flex flex-col gap-3 rounded-xl border border-(--border) p-5">
        <Note>{note}</Note>
        {c.separation && <p className="text-foreground">{c.separation}</p>}
        <p className="text-foreground">
          What you’re describing is past what I can help with.
        </p>
        <p className="text-foreground">
          Talk to someone real — a friend you trust, a group that meets in
          person, or a professional. Not because something is wrong with you.
          Some things need a person, not an app.
        </p>
        {/* TODO: region-appropriate crisis lines would be better than this, but
            a wrong or dead number is worse than none — check any by hand rather
            than generating them. Not a blocker: pointing at real people already
            does the one thing that matters, which is to stop encouraging. */}
      </section>
    );
  }

  const attribution = c.line ? quoteById(c.line.based_on)?.source : undefined;

  return (
    <section
      className={`flex flex-col gap-4 rounded-xl p-5`}
    >
      <Note>{note}</Note>
      {(c.separation || c.line || c.capability) && (
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

          {c.capability && <p className="text-sm text-(--muted)">{c.capability}</p>}
        </div>
      )}
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
