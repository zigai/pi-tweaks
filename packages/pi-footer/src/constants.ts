export const ACTIVE_FOOTER_VARIANT = "plain" as const;
export const BRANCH_ICON = "";

export const FOOTER_LAYOUT = {
    left: ["path", "branch", "provider", "model", "thinking"],
    right: ["context"],
    hidden: [],
} as const;

export const BLOCK_COLORS = {
    path: { bg: "#222222", fg: "#cccccc" },
    branch: { bg: "#95ffa4", fg: "#222222" },
    provider: { bg: "#24292f", fg: "#ffffff" },
    model: { bg: "#007acc", fg: "#ffffff" },
    thinking: { bg: "#8b5cf6", fg: "#ffffff" },
    mcp: { bg: "#7c3aed", fg: "#ffffff" },
    context: { bg: "#06b6d4", fg: "#062b33" },
} as const;

export const PLAIN_COLORS = {
    bg: "#000000",
    fg: "#9ca3af",
} as const;

export const PLAIN_SEPARATOR_COLORS = {
    bg: "#000000",
    fg: "#6b7280",
} as const;

export const CUSTOM_SLOT_COLORS = {
    bg: "#374151",
    fg: "#e5e7eb",
} as const;
