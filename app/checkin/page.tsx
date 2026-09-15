"use client";
import { useEffect, useState } from "react";
import { getGoals, type Goal } from "@/lib/goal";
import { createClient } from "@/lib/supabase/client"
import GoalSetup from "@/components/checkin/goal-setup";
import GoalTabs from "@/components/checkin/goal-tabs";
import Thread from "@/components/checkin/thread"
import { syncTimezone } from "@/lib/profile";

export default function CheckinPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [email, setEmail] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
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
    syncTimezone();
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
      <GoalTabs
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





