import os from "node:os";
import path from "node:path";

export function expandUserPath(value: string): string {
    if (value === "~") return os.homedir();
    if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
    return value;
}

export function getGlobalAgentDir(): string {
    const env = process.env.PI_CODING_AGENT_DIR;
    if (env !== undefined && env.length > 0) return expandUserPath(env);
    return path.join(os.homedir(), ".pi", "agent");
}

export function getSessionDirForCwd(cwd: string): string {
    const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
    return path.join(getGlobalAgentDir(), "sessions", safePath);
}
