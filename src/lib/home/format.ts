const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(count: number, unit: string): string {
	if (count === 1) return `1 ${unit} ago`;
	return `${count} ${unit}s ago`;
}

/** "just now", "5 minutes ago", "2 days ago"; older than 30 days is a date. */
export function relativeTime(timestamp: number, now: number): string {
	const age = Math.max(0, now - timestamp);
	if (age < MINUTE) return 'just now';
	if (age < HOUR) return plural(Math.floor(age / MINUTE), 'minute');
	if (age < DAY) return plural(Math.floor(age / HOUR), 'hour');
	if (age < 30 * DAY) return plural(Math.floor(age / DAY), 'day');
	return new Date(timestamp).toLocaleDateString();
}
