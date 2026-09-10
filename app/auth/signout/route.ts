import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function POST() {
	const supabase = createClient(await cookies());
	await supabase.auth.signOut();
	redirect("/login")
	
}