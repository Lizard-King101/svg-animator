export type RuntimeErrorCode = "invalid-bundle" | "unsupported-bundle-version" | "unsupported-capability" | "artwork-signature-mismatch" | "svg-root-not-found" | "fetch-failed" | "malformed-json" | "player-destroyed";
export declare class RuntimePlayerError extends Error {
    readonly code: RuntimeErrorCode;
    readonly cause?: unknown | undefined;
    readonly name = "RuntimePlayerError";
    constructor(code: RuntimeErrorCode, message: string, cause?: unknown | undefined);
}
//# sourceMappingURL=errors.d.ts.map