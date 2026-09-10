"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function LoginPage() {
	const router = useRouter();

	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");

	const [sent, setSent] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [sending, setSending] = useState(false);


	async function sendLink(e: React.SubmitEvent<HTMLFormElement>) {
		e.preventDefault();
		setSending(true);
		setError(null);

		const { error } = await createClient().auth.signInWithOtp({
			email,
			options: { emailRedirectTo: `${location.origin}/auth/callback` },
		});

		setSending(false);
		if (error) setError(error.message);
		else setSent(true);
	}

	async function signInWithPassword(e: React.SubmitEvent<HTMLFormElement>) {
		e.preventDefault();
		setSending(true);
		setError(null);

		const { error } = await createClient().auth.signInWithPassword({ 
			email, 
			password 
		});
		setSending(false);

		if (error) return setError(error.message);

		router.push("/checkin");
		router.refresh();   // Server Components still hold the logged-out render
	}

	if (sent) {
		return (
			<main className="mx-auto max-w-sm px-6 py-24">
				<p className="text-sm leading-relaxed">
					Check your email. The link signs you in — there is no password to remember.
				</p>
			</main>
		);
	}

	return (
		<main className="mx-auto flex max-w-sm flex-col gap-8 px-6 py-24">
			<div>
				<h1 className="text-lg font-medium">Sign in</h1>
				<p className="mt-1 text-sm opacity-60">
					Whatever you keep here is only yours.
				</p>
			</div>

			<form onSubmit={sendLink} className="flex flex-col gap-3">
				<input
					type="email"
					name="email"
					autoComplete="email"
					required
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="you@example.com"
					className="rounded-lg border px-3 py-2 text-sm"
				/>
				<button
					type="submit"
					disabled={sending}
					className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
				>
					{sending ? "Sending…" : "Send me a link"}
				</button>
			</form>

			{/* TEMP: scaffolding — remove once Google sign-in is wired up. */}
			<form onSubmit={signInWithPassword} className="flex flex-col gap-3 border-t pt-6">
				<p className="text-xs opacity-50">Dev only — password sign-in</p>
				<input
					type="password"
					name="password"
					autoComplete="current-password" // so the browser can recognize it as a password field
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					placeholder="password"
					className="rounded-lg border px-3 py-2 text-sm"
				/>
				<button
					type="submit"
					disabled={sending || !password}
					className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
				>
					Sign in with password
				</button>
			</form>

			{error && (
				<p role="alert" className="text-sm text-red-600">
					{error}
				</p>
			)}
		</main>
	);
}