export function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function autocompleteTriggerCharacter(trigger: string): string {
    return Array.from(trigger)[0] ?? trigger;
}
