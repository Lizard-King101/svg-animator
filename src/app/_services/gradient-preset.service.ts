import { Injectable } from "@angular/core";
import { GradientPaint } from "../editor/objects/paint.object";

export interface GradientPresetStop {
    offset: number;
    color: string;
    alpha: number;
}

export interface GradientPreset {
    id: string;
    name: string;
    stops: GradientPresetStop[];
    custom?: boolean;
}

interface GradientPresetStorageV1 {
    version: 1;
    presets: GradientPreset[];
}

const STORAGE_KEY = "svg-animator.gradient-presets";

export const BUNDLED_GRADIENT_PRESETS: readonly GradientPreset[] = [
    preset("sunset", "Sunset", ["#f97316", "#ec4899", "#7c3aed"]),
    preset("ocean", "Ocean", ["#0ea5e9", "#2563eb", "#312e81"]),
    preset("mint", "Mint", ["#d1fae5", "#34d399", "#0f766e"]),
    preset("violet", "Violet", ["#f5d0fe", "#a855f7", "#4c1d95"]),
    preset("fire", "Fire", ["#fef3c7", "#f97316", "#b91c1c"]),
    preset("steel", "Steel", ["#e2e8f0", "#64748b", "#0f172a"]),
    preset("spectrum", "Spectrum", ["#ef4444", "#f59e0b", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7"]),
    {
        id: "builtin-fade",
        name: "Fade",
        stops: [
            { offset: 0, color: "#ffffff", alpha: 1 },
            { offset: 1, color: "#ffffff", alpha: 0 },
        ],
    },
];

@Injectable({ providedIn: "root" })
export class GradientPresetService {
    private customPresets: GradientPreset[] = this.readCustomPresets();

    get presets(): readonly GradientPreset[] { return [...BUNDLED_GRADIENT_PRESETS, ...this.customPresets]; }

    save(gradient: GradientPaint): GradientPreset {
        const used = new Set(this.customPresets.map((candidate) => candidate.name));
        let index = 1;
        while(used.has(`Custom ${index}`)) index += 1;
        const saved: GradientPreset = {
            id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            name: `Custom ${index}`,
            custom: true,
            stops: [...gradient.stops]
                .sort((a, b) => a.offset - b.offset)
                .map((stop) => ({ offset: clamp01(stop.offset), color: stop.color.hex, alpha: clamp01(stop.color.alpha) })),
        };
        this.customPresets = [...this.customPresets, saved];
        this.persist();
        return saved;
    }

    delete(id: string): boolean {
        const next = this.customPresets.filter((preset) => preset.id !== id);
        if(next.length === this.customPresets.length) return false;
        this.customPresets = next;
        this.persist();
        return true;
    }

    preview(presetValue: GradientPreset): string {
        const stops = presetValue.stops
            .map((stop) => `${rgba(stop.color, stop.alpha)} ${clamp01(stop.offset) * 100}%`)
            .join(", ");
        return `linear-gradient(90deg, ${stops})`;
    }

    private readCustomPresets(): GradientPreset[] {
        try {
            const raw = storage()?.getItem(STORAGE_KEY);
            if(!raw) return [];
            const parsed = JSON.parse(raw) as Partial<GradientPresetStorageV1>;
            if(parsed.version !== 1 || !Array.isArray(parsed.presets)) return [];
            return parsed.presets.filter(isCustomPreset).map((candidate) => ({
                id: candidate.id,
                name: candidate.name,
                custom: true,
                stops: candidate.stops.map((stop) => ({ offset: clamp01(stop.offset), color: stop.color, alpha: clamp01(stop.alpha) })),
            }));
        } catch {
            return [];
        }
    }

    private persist(): void {
        try {
            const record: GradientPresetStorageV1 = { version: 1, presets: this.customPresets };
            storage()?.setItem(STORAGE_KEY, JSON.stringify(record));
        } catch {
            // Presets remain available for this session when storage is unavailable.
        }
    }
}

function preset(id: string, name: string, colors: string[]): GradientPreset {
    return {
        id: `builtin-${id}`,
        name,
        stops: colors.map((color, index) => ({
            offset: colors.length === 1 ? 0 : index / (colors.length - 1),
            color,
            alpha: 1,
        })),
    };
}

function isCustomPreset(value: unknown): value is GradientPreset {
    if(!value || typeof value !== "object") return false;
    const candidate = value as Partial<GradientPreset>;
    return typeof candidate.id === "string"
        && typeof candidate.name === "string"
        && candidate.custom === true
        && Array.isArray(candidate.stops)
        && candidate.stops.length >= 2
        && candidate.stops.every((stop) => !!stop && typeof stop.color === "string"
            && /^#[0-9a-f]{6}$/i.test(stop.color) && Number.isFinite(stop.offset) && Number.isFinite(stop.alpha));
}

function storage(): Storage | undefined { return typeof localStorage === "undefined" ? undefined : localStorage; }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function rgba(hex: string, alpha: number): string {
    const source = hex.replace("#", "");
    const r = parseInt(source.slice(0, 2), 16);
    const g = parseInt(source.slice(2, 4), 16);
    const b = parseInt(source.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
}
