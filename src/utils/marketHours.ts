export function isMarketOpen(): boolean {
	const now = new Date();
	const formatter = new Intl.DateTimeFormat('ko-KR', {
		timeZone: 'Asia/Seoul',
		hour: 'numeric',
		minute: 'numeric',
		weekday: 'short',
		hour12: false,
	});

	const parts = formatter.formatToParts(now);
	const weekday = parts.find(p => p.type === 'weekday')?.value ?? '';
	const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
	const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);

	// 토, 일 → 장 휴무
	if (weekday === '토' || weekday === '일') {
		return false;
	}

	const timeMinutes = hour * 60 + minute;
	// 09:00 ~ 15:30
	return timeMinutes >= 540 && timeMinutes < 930;
}
