const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Short "edited" phrase for a timestamp: just now, minutes, hours, yesterday, weekday, then a date. */
export function formatEditedTime(timestamp: number, now = Date.now(), locale?: string): string {
    const elapsed = Math.max(0, now - timestamp);
    if(elapsed < MINUTE) return "Edited just now";
    if(elapsed < HOUR) return `Edited ${Math.floor(elapsed / MINUTE)} min ago`;

    const date = new Date(timestamp);
    const today = new Date(now);
    const days = calendarDaysBetween(date, today);
    if(days === 0) return `Edited ${Math.floor(elapsed / HOUR)} h ago`;
    if(days === 1) return "Edited yesterday";
    if(days < 7) return `Edited ${date.toLocaleDateString(locale, { weekday: "long" })}`;
    const sameYear = date.getFullYear() === today.getFullYear();
    return `Edited ${date.toLocaleDateString(locale, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })}`;
}

/** Full local date and time, for tooltips. */
export function formatFullTime(timestamp: number, locale?: string): string {
    return new Date(timestamp).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

function calendarDaysBetween(from: Date, to: Date): number {
    const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
    const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((end - start) / DAY);
}
