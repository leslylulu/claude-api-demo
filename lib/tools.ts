export async function runTool(name: string, input: unknown): Promise<string> {
	if (name === "get_weather") {
		const { city } = input as { city: string };
		return JSON.stringify(mockWeather(city));
	}
	return JSON.stringify({ error: `Unknown tool: ${name}` });
}

function mockWeather(city: string) {
	const conditions = ["sunny", "cloudy", "partly cloudy", "light rain", "clear"];
	const condition = conditions[Math.floor(Math.random() * conditions.length)];

	return {
		city,
		condition,
		temperature_c: Math.round(10 + Math.random() * 15),
		humidity_percent: Math.round(50 + Math.random() * 30)
	};
}
