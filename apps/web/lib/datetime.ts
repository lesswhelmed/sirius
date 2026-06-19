const LOCALE = "en-US";
const TIMEZONE = "America/New_York";

export const dateLongFmt = new Intl.DateTimeFormat(LOCALE, {
	timeZone: TIMEZONE,
	year: "numeric",
	month: "long",
	day: "numeric",
});

export const dateShortFmt = new Intl.DateTimeFormat(LOCALE, {
	timeZone: TIMEZONE,
	year: "numeric",
	month: "short",
	day: "numeric",
});

export const timeFmt = new Intl.DateTimeFormat(LOCALE, {
	timeZone: TIMEZONE,
	hour12: false,
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
});

export const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
	timeZone: TIMEZONE,
	year: "numeric",
	month: "short",
	day: "numeric",
	hour12: false,
	hour: "2-digit",
	minute: "2-digit",
});

export type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
	if (value == null) return null;
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

function format(fmt: Intl.DateTimeFormat, value: DateInput): string {
	const d = toDate(value);
	return d ? fmt.format(d) : "—";
}

export const formatDateLong = (value: DateInput) => format(dateLongFmt, value);
export const formatDateShort = (value: DateInput) =>
	format(dateShortFmt, value);
export const formatTime = (value: DateInput) => format(timeFmt, value);
export const formatDateTime = (value: DateInput) => format(dateTimeFmt, value);

export function relativeAge(value: DateInput, now: number): string {
	const d = toDate(value);
	if (!d) return "—";
	const s = Math.max(0, Math.floor((now - d.getTime()) / 1000));
	if (s < 60) return `${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	return `${Math.floor(h / 24)}d ago`;
}
