
export type ToolOutcome = {
	content: string;
	is_error?: boolean;
};

// const TOOL_TIMEOUT_MS = 5000


export async function runTool(name: string, input: unknown): Promise<ToolOutcome> {
	try{
		switch(name){
			case "get_weather":
				return ok(await getWeather(input));
			case "get_stock_price":
				return ok(await getStockPrice(input));
			default:
				return fail(`UnKnow tool: ${name}`)
		}
	}catch(err){
		return fail(err instanceof Error ? err.message : String(err))
	}
}

const ok = (data: unknown): ToolOutcome => ({
	content: JSON.stringify(data)
})


const fail = (message: string): ToolOutcome => ({
	content: JSON.stringify({error: message}),
	is_error: true
})

function getWeather(input: unknown) {
	const { city } = (input ?? {}) as { city ?: string};

	if (!city?.trim()) throw new Error("Missing required field: city")

	const conditions = ["sunny", "cloudy", "partly cloudy", "light rain", "clear"];
	return {
		city,
		condition: conditions[Math.floor(Math.random() * conditions.length)],
		temperature_c: Math.round(10 + Math.random() * 15),
		humidity_percent: Math.round(50 + Math.random() * 30),
	};
}


const PRICES: Record<string, number> = { AAPL: 271.4, NVDA: 184.2, TSLA: 421.9 };

function getStockPrice(input: unknown) {
	const { symbol } = (input ?? {}) as { symbol?: string };
	
	if (!symbol?.trim()) throw new Error("Missing required field: symbol");

	const key = symbol.trim().toUpperCase();
	const price = PRICES[key];
	if (price === undefined) {
		throw new Error(`Unknown symbol: ${key}. Known symbols: ${Object.keys(PRICES).join(", ")}`);
	}
	return { symbol: key, price_usd: price, currency: "USD" };
}