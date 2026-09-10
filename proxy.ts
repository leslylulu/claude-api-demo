import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export async function proxy(request: NextRequest) {
	let response = NextResponse.next({ request });

	const supabase = createServerClient(
		supabaseUrl!,
		supabaseKey!,
		{
			cookies: {
				getAll: () => request.cookies.getAll(),
				setAll: (toSet) => {
					toSet.forEach(({ name, value }) => request.cookies.set(name, value));
					response = NextResponse.next({ request });
					toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
				},
			},
		},
	);

	// getUser(), never getSession(): getSession trusts the cookie as-is.
	// getUser() asks the auth server whether the token is real.
	const { data: { user } } = await supabase.auth.getUser();

	if (!user && request.nextUrl.pathname.startsWith("/checkin")) {
		const url = request.nextUrl.clone();
		url.pathname = "/login";
		return NextResponse.redirect(url);
	}

	// No  NextResponse.next()
	return response;
}

export const config = {
	matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};