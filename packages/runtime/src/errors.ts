export type RuntimeErrorCode =
    | "invalid-bundle"
    | "unsupported-bundle-version"
    | "unsupported-capability"
    | "artwork-signature-mismatch"
    | "svg-root-not-found"
    | "fetch-failed"
    | "malformed-json"
    | "player-destroyed";

export class RuntimePlayerError extends Error {
    override readonly name = "RuntimePlayerError";
    constructor(public readonly code: RuntimeErrorCode, message: string, public override readonly cause?: unknown) {
        super(message);
    }
}
