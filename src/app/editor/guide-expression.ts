/** Evaluates the compact expressions accepted by the guide position popover. */
export function parseGuideExpression(input: string, width: number, height: number, axis: "x" | "y"): number | undefined {
    const raw = input.trim().toLowerCase();
    const axisLength = axis === "x" ? width : height;
    if(raw === "center") return axisLength / 2;

    if(/^-\d+(\.\d+)?$/.test(raw)) return axisLength + Number(raw);

    const percent = /^(-?\d+(\.\d+)?)%$/.exec(raw);
    if(percent) return axisLength * Number(percent[1]) / 100;

    const tokens = tokenizeGuideExpression(raw);
    if(tokens.length === 0) return undefined;

    let index = 0;
    const peek = () => tokens[index];
    const consume = () => tokens[index++];

    const parseFactor = (): number | undefined => {
        const token = consume();
        if(!token) return undefined;
        if(token === "+") return parseFactor();
        if(token === "-") {
            const value = parseFactor();
            return value == null ? undefined : -value;
        }
        if(token === "(") {
            const value = parseExpression();
            return consume() === ")" ? value : undefined;
        }
        if(token === "w") return width;
        if(token === "h") return height;
        const numeric = Number(token);
        return Number.isFinite(numeric) ? numeric : undefined;
    };

    const parseTerm = (): number | undefined => {
        let value = parseFactor();
        while(value != null && (peek() === "*" || peek() === "/")) {
            const operator = consume();
            const right = parseFactor();
            if(right == null) return undefined;
            value = operator === "*" ? value * right : value / right;
        }
        return value;
    };

    const parseExpression = (): number | undefined => {
        let value = parseTerm();
        while(value != null && (peek() === "+" || peek() === "-")) {
            const operator = consume();
            const right = parseTerm();
            if(right == null) return undefined;
            value = operator === "+" ? value + right : value - right;
        }
        return value;
    };

    const value = parseExpression();
    return value != null && index === tokens.length && Number.isFinite(value) ? value : undefined;
}

function tokenizeGuideExpression(input: string): string[] {
    const tokens: string[] = [];
    let index = 0;
    while(index < input.length) {
        const char = input[index];
        if(/\s/.test(char)) {
            index++;
            continue;
        }
        if(/[()+\-*/]/.test(char)) {
            tokens.push(char);
            index++;
            continue;
        }
        const numberMatch = /^\d+(\.\d+)?/.exec(input.slice(index));
        if(numberMatch) {
            tokens.push(numberMatch[0]);
            index += numberMatch[0].length;
            continue;
        }
        if(char === "w" || char === "h") {
            tokens.push(char);
            index++;
            continue;
        }
        return [];
    }
    return tokens;
}
