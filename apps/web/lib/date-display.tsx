import { memo } from "react";

import {
	type DateInput,
	dateLongFmt,
	dateShortFmt,
	dateTimeFmt,
	timeFmt,
} from "./datetime";

type Variant = "date-long" | "date-short" | "time" | "date-time";

const FORMATTER: Record<Variant, Intl.DateTimeFormat> = {
	"date-long": dateLongFmt,
	"date-short": dateShortFmt,
	time: timeFmt,
	"date-time": dateTimeFmt,
};

function toDate(value: DateInput): Date | null {
	if (value == null) return null;
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

export interface DateDisplayProps {
	value: DateInput;
	variant?: Variant;
	className?: string;
	title?: string;
}

export const DateDisplay = memo(function DateDisplay({
	value,
	variant = "date-short",
	className,
	title,
}: DateDisplayProps) {
	const d = toDate(value);
	if (!d) {
		return (
			<span className={className} title={title}>
				—
			</span>
		);
	}
	return (
		<time dateTime={d.toISOString()} className={className} title={title}>
			{FORMATTER[variant].format(d)}
		</time>
	);
});
