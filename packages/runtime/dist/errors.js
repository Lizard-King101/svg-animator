export class RuntimePlayerError extends Error {
    constructor(code, message, cause) {
        super(message);
        this.code = code;
        this.cause = cause;
        this.name = "RuntimePlayerError";
    }
}
//# sourceMappingURL=errors.js.map