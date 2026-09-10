import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

export async function GET(request: Request) {

	const { searchParams} = new URL(request.url);
	const next = searchParams.get("next") ?? "/checkin";

	// PKCE: the browser stashed a code_verifier cookie before sending the mail,
	// so the exchange has to happen server-side, where that cookie is readable.
	const code = searchParams.get("code");
	const token_hash = searchParams.get("token_hash");
	const type = searchParams.get("type") as EmailOtpType | null;


	const supabase = await createClient(await cookies());

	if (code) {
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (!error) redirect(next);
	} else if (token_hash && type) {
		// Only reachable if the email template is ever switched to {{ .TokenHash }}.
		const { error } = await supabase.auth.verifyOtp({ type, token_hash });
		if (!error) redirect(next);
	}

	redirect("/login?error=1");
	
}