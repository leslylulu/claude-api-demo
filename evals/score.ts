import { existsSync, readdirSync, readFileSync } from "node:fs";

import { CASES } from "./case";
import type { Checkin } from "../lib/checkin";
import type { CheckinStats } from "@/lib/prompt";

const dir = "evals/runs";
const latest = existsSync(dir) ? readdirSync(dir).sort().at(-1) : undefined;
const file = process.argv[2] ?? (latest && `${dir}/${latest}`);

if (!file) {
	console.error("No runs found. Generate one first:\n\n  npm run eval:run\n");
	process.exit(1);
}

const run = JSON.parse(readFileSync(file, "utf8"));

const byId = new Map<string, Checkin>(
	run.results.map((item: { case: string; results: Checkin }) => [item.case, item.results]),
);

console.log(`\n━━ ${file}  ·  ${run.model} · ${run.effort} · ${run.results.length} cases`);

let passed = 0;
let total = 0;

type Line = {
	ok: boolean;
	text: string;
	got?: string;
	because?: string;
};

const structure: {
	id: string;
	lines: Line[];
}[] = [];

const invented: string[] = [];

const check = (result: Checkin, field: string, want: unknown): boolean => {
	const value = result[field as keyof Checkin];
	if (want === "present") return value !== null && value !== undefined;
	if (want === "null") return value === null;
	return value === want;
};

function inventedNumbers(text: string, s: CheckinStats, note: string): string[] {
	const allowed = new Set([
		...[s.days, s.hardDays, s.goodDays, s.dayNumber].map(String),
		// numbers the user wrote are theirs to quote back
		...(note.match(/\d+/g) ?? []),
	]);
	const found = text.match(/\d+/g) ?? [];
	return found.filter((n) => !allowed.has(n));
}

for (const c of CASES) {
	const result = byId.get(c.id);
	if (!result) continue;

	if (result.action) {
		const bad = inventedNumbers(result.action, c.stats, c.note);
		if (bad.length) {
			invented.push(`${c.id.padEnd(24)} ${bad.join(", ")}\n${" ".repeat(27)}in: ${result.action}`);
		}
	}

	const lines: Line[] = [];

	for (const [field, want] of Object.entries(c.expect)) {
		total++;
		const ok = check(result, field, want);
		if (ok) passed++;
		lines.push({
			ok,
			text: `${field.padEnd(16)} ${want}`,
			got: ok ? undefined : JSON.stringify(result[field as keyof Checkin]),
			because: ok ? undefined : c.because,
		});
	}
	structure.push({ id: c.id, lines });
}

function grams(text: string): Set<string> {
	const s = text.replace(/\s+/g, "");
	const out = new Set<string>();
	for (let i = 0; i + 4 <= s.length; i++) out.add(s.slice(i, i + 4));
	return out;
}

function similarity(a: string, b: string): number {
	const [ga, gb] = [grams(a), grams(b)];
	if (!ga.size || !gb.size) return 0;
	let shared = 0;
	for (const g of ga) if (gb.has(g)) shared++;
	return shared / Math.min(ga.size, gb.size);
}

// ─────────────────────────────────────────────────────────────
console.log(`\n📋 STRUCTURE  ·  ${passed}/${total}`);

for (const { id, lines } of structure) {
	console.log(`\n   ${id}`);
	for (const line of lines) {
		console.log(`      ${line.ok ? "✅" : "❌"} ${line.text}`);
		if (!line.ok) {
			console.log(`         got  ${line.got}`);
			console.log(`         why  ${line.because?.replace(/\s+/g, " ").slice(0, 160)}`);
		}
	}
}

// ─────────────────────────────────────────────────────────────
// Crude but decisive: does the card use CJK script when the note does, and not
// when it doesn't? Cannot tell Spanish from English — it catches the one failure
// that actually happened.
const cjk = (t: string) => /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(t);

console.log(`\n🌐 LANGUAGE  ·  card must answer in the note's script  ·  CJK vs not`);

let wrongLang = 0;
for (const c of CASES) {
	const result = byId.get(c.id);
	if (!result) continue;

	const want = cjk(c.note);
	const fields: [string, string][] = [
		["emotion", result.emotion ?? ""],
		["action", result.action ?? ""],
		["encouragement", result.encouragement],
		[
			"ask_for_reason",
			result.ask_for_reason
				? [result.ask_for_reason.question, ...result.ask_for_reason.options].join(" ")
				: "",
		],
	];

	const bad = fields.filter(([, text]) => text && cjk(text) !== want);
	if (bad.length) {
		wrongLang++;
		console.log(`\n   ❌ ${c.id}  ·  note is ${want ? "CJK" : "non-CJK"}, card is not`);
		for (const [name, text] of bad) console.log(`      ${name.padEnd(15)} ${text.slice(0, 90)}`);
	}
}
if (!wrongLang) console.log(`\n   ✅ every card answers in its note's script`);

// ─────────────────────────────────────────────────────────────
console.log(`\n🔢 NUMBERS  ·  one card · action · digits vs stats  ·  ⚠️ blind to "six"`);

if (invented.length) for (const i of invented) console.log(`\n   ❌ ${i}`);
else console.log(`\n   ✅ none`);

// ─────────────────────────────────────────────────────────────
console.log(`\n♻️  ECHO  ·  one card · action ↔ encouragement  ·  flag >25%`);

let overlap = 0;
for (const [id, result] of byId) {
	if (!result.action || !result.encouragement) continue;
	const score = similarity(result.action, result.encouragement);
	if (score > 0.25) {
		overlap++;
		console.log(`\n   ❌ ${id}  ${(score * 100).toFixed(0)}%`);
		console.log(`      action         ${result.action}`);
		console.log(`      encouragement  ${result.encouragement}`);
	}
}
if (!overlap) console.log(`\n   ✅ nothing above 25%`);

// ─────────────────────────────────────────────────────────────
console.log(`\n🔁 ECHO  ·  many cards · same field · worst pair  ·  flag >40%\n`);

function echoScore(field: "emotion" | "action" | "encouragement") {
	const items = [...byId.entries()]
		.map(([id, result]) => ({ id, text: result[field] }))
		.filter((item): item is { id: string; text: string } => !!item.text);

	let worst = { score: 0, a: "", b: "", ta: "", tb: "" };
	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			const score = similarity(items[i].text, items[j].text);
			if (score > worst.score) {
				worst = {
					score,
					a: items[i].id,
					ta: items[i].text,
					b: items[j].id,
					tb: items[j].text,
				};
			}
		}
	}
	return { worst, n: items.length };
}

for (const field of ["emotion", "action", "encouragement"] as const) {
	const { worst, n } = echoScore(field);
	const pct = worst.score * 100;
	const mark = n < 2 ? "➖" : pct > 40 ? "❌" : "✅";
	const note = n < 2 ? "  (need 2+ cards to compare)" : "";
	console.log(`   ${mark} ${field.padEnd(15)} ${pct.toFixed(0).padStart(3)}%   ${n} cards${note}`);
	if (pct > 40) {
		console.log(`      ${worst.a.padEnd(24)} ${worst.ta}`);
		console.log(`      ${worst.b.padEnd(24)} ${worst.tb}`);
	}
}

console.log("");
