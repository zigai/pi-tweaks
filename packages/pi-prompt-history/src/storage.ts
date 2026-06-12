import { getAgentDir } from "@earendil-works/pi-coding-agent";
import path from "node:path";

export function getGlobalAgentDir(): string {
    return getAgentDir();
}

export function getSessionDirForCwd(cwd: string): string {
    const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
    return path.join(getGlobalAgentDir(), "sessions", safePath);
}
