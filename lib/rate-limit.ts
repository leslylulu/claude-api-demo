// A per-instance sliding window. On serverless this is NOT a global limit:
// every warm instance keeps its own counters and a cold start wipes them, so a
// determined attacker spread across instances gets through. It costs nothing,
// needs no extra service, and stops the case that actually happens — one person
// or one script hammering the same endpoint.
//
// The real cost ceiling is the workspace spend limit in the Console. This only
// buys time before it is reached, and keeps normal visitors working while
// someone else is being greedy.

const hits = new Map<string, number[]>();

// Without this the map grows for every IP that ever visits.
function sweep(now: number, windowMs: number) {
	for (const [key, times] of hits) {
		if (times.every((t) => now - t >= windowMs)) hits.delete(key);
	}
}

export function allow(key: string, limit: number, windowMs: number): boolean {
	const now = Date.now();
	if (hits.size > 5000) sweep(now, windowMs);

	const times = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
	if (times.length >= limit) return false;

	times.push(now);
	hits.set(key, times);
	return true;
}

// x-forwarded-for is a comma-separated chain and only the first entry is the
// client; the rest are proxies. It is spoofable in general, but behind a
// platform proxy (Vercel and friends overwrite it) the first entry is real.
export const clientIp = (req: Request): string =>
	req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
	req.headers.get("x-real-ip") ||
	"unknown";
