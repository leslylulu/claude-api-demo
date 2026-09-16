import { createClient } from "./supabase/client";
import { browserTz } from "./day";

export async function syncTimezone(): Promise<string | null> {
	const tz = browserTz();
	const supabase = createClient();

	const {
		data: { user },
	} = await supabase.auth.getUser();

	if (!user) return null;

	const { error } = await supabase.from("profiles").upsert({
		id: user.id,
		timezone: tz,
		updated_at: new Date().toISOString(),
	});
	if (error) console.error(error);
	return tz;
}
