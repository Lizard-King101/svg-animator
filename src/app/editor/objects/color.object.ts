export class Color {
    _hex: string = '#ff0000';
    _rgb: RGB = {r: 255, g: 0, b: 0};
    _hsl: HSL = {h: 0, s: 100, l: 50};
    preferredSpace: ColorSpace = 'rgb';
    alpha: number = 1;

    get hex(): string {
        return this._hex;
    }
    set hex(hex: string) {
        const expanded = expandHex(hex);
        if(expanded.length !== 6 && expanded.length !== 8) return;
        this._hex = `#${expanded.slice(0, 6)}`;
        if(expanded.length === 8) this.alpha = parseInt(expanded.slice(6, 8), 16) / 255;
        this._rgb = this.hexToRgb(this._hex);
        this._hsl = this.rgbToHsl(this._rgb);
    }

    get serialized(): string {
        if(this.alpha >= 0.9999) return this.hex;
        return `${this.hex}${Math.round(this.alpha * 255).toString(16).padStart(2, '0')}`;
    }

    get rgb(): RGB {
        return this._rgb;
    }
    set rgb(rgb: RGB) {
        this._rgb = normalizeRgb(rgb);
        this._hex = this.rgbToHex(this._rgb);
        this._hsl = this.rgbToHsl(this.rgb);
    }


    get hsl(): HSL {
        return this._hsl;
    }
    set hsl(hsl: HSL) {
        this._hsl = normalizeHsl(hsl);
        this._rgb = this.hslToRgb(this._hsl);
        this._hex = this.rgbToHex(this._rgb);
    }

    constructor(hex?: string) {
        if(hex && this.isColor(hex)) {
            const expanded = expandHex(hex);
            this.alpha = expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1;
            this.rgb = this.hexToRgb(expanded.slice(0, 6));
        } else {
            this.rgb = {r: 255, g: 0, b: 0};
        }

    }

    isColor(color: any): boolean {
        if(color && typeof color === 'object' && Number.isFinite(color.r) && Number.isFinite(color.g) && Number.isFinite(color.b)) return true;
        if(color && typeof color === 'object' && Number.isFinite(color.h) && Number.isFinite(color.s) && Number.isFinite(color.l)) return true;
        if(typeof color == 'string' && /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) return true;
        return false;
    }

    hslToRgb(hsl: HSL): RGB {
        let { h, s, l } = normalizeHsl(hsl);
        h /= 360; s /= 100; l /= 100;
        var r, g, b;

        if (s == 0) {
            r = g = b = Math.round(l * 255); // achromatic
        } else {
            function hue2rgb(p: any, q: any, t: any) {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            }

            var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            var p = 2 * l - q;

            r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
            g = Math.round(hue2rgb(p, q, h) * 255);
            b = Math.round(hue2rgb(p, q, h - 1/3) * 255);
        }
        return {
            r, 
            g, 
            b
        };
    }

    rgbToHsl(rgb: RGB): HSL {
        let { r, g, b } = rgb;
        r /= 255;
        g /= 255;
        b /= 255;
      
        let cmin = Math.min(r,g,b),
            cmax = Math.max(r,g,b),
            delta = cmax - cmin,
            h = 0,
            s = 0,
            l = 0;

        if (delta == 0) h = 0;
        else if (cmax == r)  h = ((g - b) / delta) % 6;
        else if (cmax == g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
      
        h = Math.round(h * 60);
      
        if (h < 0) h += 360;
      
        l = (cmax + cmin) / 2;
      
        s = delta == 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
      
        s = Math.round(s * 100);
        l = Math.round(l * 100);
      
        return {
            h,
            s,
            l
        }
    }
    
    hexToRgb(hex: string): RGB {
        var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if(result) {
            return {
                r: parseInt(result[1], 16),
                g: parseInt(result[2], 16),
                b: parseInt(result[3], 16)
            }
        } else {
            return {r: 255, g: 0, b: 0};
        }
    }

    rgbToHex(rgb: RGB): string {
        let { r, g, b } = normalizeRgb(rgb);
        let componentToHex = (c: number) => {
            var hex = c.toString(16);
            return hex.length == 1 ? "0" + hex : hex;
        }
        return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
    }
}

export interface RGB {
    r: number;
    g: number;
    b: number;
}

export interface HSL {
    h: number;
    s: number;
    l: number;
}

/** Preserve the user's active color-space coordinates instead of round-tripping through quantized hex. */
export function cloneColor(color: Color): Color {
    const clone = new Color(color.serialized);
    clone.preferredSpace = color.preferredSpace;
    if(color.preferredSpace === "hsl") clone.hsl = { ...color.hsl };
    return clone;
}

function expandHex(value: string): string {
    const source = value.replace(/^#/, '').toLowerCase();
    if(source.length === 3 || source.length === 4) return source.split('').map((part) => part + part).join('');
    return source;
}

export type ColorSpace = 'rgb' | 'hsl';

function normalizeRgb(rgb: RGB): RGB {
    return {
        r: Math.round(clamp(Number(rgb.r), 0, 255)),
        g: Math.round(clamp(Number(rgb.g), 0, 255)),
        b: Math.round(clamp(Number(rgb.b), 0, 255)),
    };
}

function normalizeHsl(hsl: HSL): HSL {
    return {
        h: clamp(Number(hsl.h), 0, 360),
        s: clamp(Number(hsl.s), 0, 100),
        l: clamp(Number(hsl.l), 0, 100),
    };
}

function clamp(value: number, min: number, max: number): number {
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}
