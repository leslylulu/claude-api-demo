import { mkdirSync, writeFileSync } from "node:fs";
import { CASES } from "./case";
import { runCheckIn, MODEL, EFFORT } from "@/lib/checkin-run";

async function main() {
	const started = new Date().toISOString();
	const results = [];

	let cost = { input: 0, cached: 0, output: 0 };

	for (const c of CASES) {
		process.stdout.write(` ${c.id} ...`);
		const response = await runCheckIn({
			goal: c.goal,
			why: c.why,
			note: c.note,
			history: c.history,
			stats: c.stats,
		});

		const usage = response.usage;
		cost.input += usage.input_tokens;
		cost.cached += usage.cache_read_input_tokens ?? 0;
		cost.output += usage.output_tokens;

		results.push({
			case: c.id,
			results: response.parsed_output,
		});
		console.log("------ ✅");
	}

	const run = {
		started,
		model: MODEL,
		effort: EFFORT,
		cost,
		results,
	};

	mkdirSync("evals/runs", { recursive: true });

	const path = `evals/runs/${started.replace(/[:.]/g, "-")}.json`;
	writeFileSync(path, JSON.stringify(run, null, 2));

	console.log(`\n${path}`);
	console.log(`tokens: ${cost.input} in / ${cost.cached} cached / ${cost.output} out`);
}

main();
