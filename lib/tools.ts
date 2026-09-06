export async function runTool(name: string, input: unknown): Promise<string> {
	if (name === "get_weather") {
		const { city } = input as { city: string };
		return JSON.stringify(mockWeather(city));
	}
	return JSON.stringify({ error: `Unknown tool: ${name}` });
}

function mockWeather(city: string) {
	const conditions = ["sunny", "cloudy", "partly cloudy", "light rain", "clear"];

	const hourly = Array.from({ length: 24 }, (_, i) => {
		const hour = (new Date().getHours() + i) % 24;
		return {
			time: `${String(hour).padStart(2, "0")}:00`,
			temperature_c: Math.round(15 + Math.sin(i / 4) * 5),
			humidity_percent: Math.round(50 + Math.random() * 30),
			wind_speed_kmh: Math.round(5 + Math.random() * 15),
			precipitation_mm: Math.round(Math.random() * 3 * 10) / 10,
			condition: conditions[Math.floor(Math.random() * conditions.length)]
		};
	});

	return {
		city,
		summary: `${city} will see mostly cloudy skies over the next 24 hours, with temperatures ranging from 15 to 20 degrees Celsius, occasional light rain, and mild winds.`,
		current: {
			temperature_c: hourly[0].temperature_c,
			condition: hourly[0].condition,
			humidity_percent: hourly[0].humidity_percent,
			wind_speed_kmh: hourly[0].wind_speed_kmh
		},
		hourly_forecast: hourly
	};
}