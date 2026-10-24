import { formatEditedTime } from "./relative-time";

describe("formatEditedTime", () => {
    const now = new Date(2026, 9, 24, 15, 30).getTime();
    const at = (...parts: [number, number, number, number?, number?]) => new Date(parts[0], parts[1], parts[2], parts[3] ?? 12, parts[4] ?? 0).getTime();

    it("describes recent edits relatively and older ones by date", () => {
        expect(formatEditedTime(now - 20_000, now, "en-US")).toBe("Edited just now");
        expect(formatEditedTime(now + 5_000, now, "en-US")).toBe("Edited just now");
        expect(formatEditedTime(now - 5 * 60_000, now, "en-US")).toBe("Edited 5 min ago");
        expect(formatEditedTime(at(2026, 9, 24, 9), now, "en-US")).toBe("Edited 6 h ago");
        expect(formatEditedTime(at(2026, 9, 23, 23), now, "en-US")).toBe("Edited yesterday");
        expect(formatEditedTime(at(2026, 9, 20), now, "en-US")).toBe("Edited Tuesday");
        expect(formatEditedTime(at(2026, 6, 17), now, "en-US")).toBe("Edited Jul 17");
        expect(formatEditedTime(at(2025, 11, 31), now, "en-US")).toBe("Edited Dec 31, 2025");
    });
});
