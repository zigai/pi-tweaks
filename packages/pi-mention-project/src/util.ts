export function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compareProjectNames(left: string, right: string): number {
    return left.localeCompare(right, undefined, { sensitivity: "base" });
}
