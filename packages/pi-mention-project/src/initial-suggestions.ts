import type { InitialSuggestionsSettings } from "./settings.ts";

const FRECENCY_HALF_LIFE_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

type Selection = {
    readonly count: number;
    readonly lastSelectedAt: number;
};

export type SelectionHistory = {
    load(): Promise<ReadonlyMap<string, Selection>>;
    recordSelection(name: string): void;
    flush(): Promise<void>;
};

export type SelectionHistoryOptions = {
    readonly filePath?: string;
    readonly now?: () => number;
    readonly onError?: (message: string) => void;
};

function compareNames(left: string, right: string): number {
    return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function historyRankingNeeded(strategy: InitialSuggestionsSettings["strategy"]): boolean {
    return strategy === "frecency" || strategy === "recent" || strategy === "frequent";
}

function frecencyScore(selection: Selection | undefined, now: number): number {
    if (selection === undefined) return 0;
    const ageDays = Math.max(0, now - selection.lastSelectedAt) / MILLISECONDS_PER_DAY;
    return selection.count / (1 + ageDays / FRECENCY_HALF_LIFE_DAYS);
}

export function rankInitialSuggestions<T>(
    items: readonly T[],
    nameOf: (item: T) => string,
    settings: InitialSuggestionsSettings,
    selections: ReadonlyMap<string, Selection>,
    now = Date.now(),
): T[] {
    const pinnedIndexes = new Map(settings.pinned.map((name, index) => [name, index]));
    const ranked = items.map((item, sourceIndex) => ({
        item,
        name: nameOf(item),
        sourceIndex,
    }));

    ranked.sort((left, right) => {
        const leftPin = pinnedIndexes.get(left.name);
        const rightPin = pinnedIndexes.get(right.name);
        if (leftPin !== undefined || rightPin !== undefined) {
            if (leftPin === undefined) return 1;
            if (rightPin === undefined) return -1;
            return leftPin - rightPin;
        }

        const leftSelection = selections.get(left.name);
        const rightSelection = selections.get(right.name);
        switch (settings.strategy) {
            case "alphabetical": {
                const comparison = compareNames(left.name, right.name);
                if (comparison !== 0) return comparison;
                break;
            }
            case "recent": {
                const comparison =
                    (rightSelection?.lastSelectedAt ?? -1) - (leftSelection?.lastSelectedAt ?? -1);
                if (comparison !== 0) return comparison;
                break;
            }
            case "frequent": {
                const comparison = (rightSelection?.count ?? 0) - (leftSelection?.count ?? 0);
                if (comparison !== 0) return comparison;
                const recencyComparison =
                    (rightSelection?.lastSelectedAt ?? -1) - (leftSelection?.lastSelectedAt ?? -1);
                if (recencyComparison !== 0) return recencyComparison;
                break;
            }
            case "frecency": {
                const comparison =
                    frecencyScore(rightSelection, now) - frecencyScore(leftSelection, now);
                if (comparison !== 0) return comparison;
                const recencyComparison =
                    (rightSelection?.lastSelectedAt ?? -1) - (leftSelection?.lastSelectedAt ?? -1);
                if (recencyComparison !== 0) return recencyComparison;
                break;
            }
            case "sourceOrder":
                break;
        }
        return left.sourceIndex - right.sourceIndex;
    });

    return ranked.map(({ item }) => item);
}

export async function rankWithSelectionHistory<T>(
    items: readonly T[],
    nameOf: (item: T) => string,
    settings: InitialSuggestionsSettings,
    history: SelectionHistory | undefined,
): Promise<T[]> {
    let selections: ReadonlyMap<string, Selection> = new Map();
    if (history !== undefined && historyRankingNeeded(settings.strategy)) {
        selections = await history.load();
    }
    return rankInitialSuggestions(items, nameOf, settings, selections);
}

export function createLazySelectionHistory(
    options: SelectionHistoryOptions = {},
): SelectionHistory {
    let historyTask: Promise<SelectionHistory> | undefined;
    let pendingRecords = Promise.resolve();
    let errorReported = false;

    const reportError = (): void => {
        if (errorReported) return;
        errorReported = true;
        options.onError?.("pi-mention-project could not use its selection history.");
    };
    const unavailableHistory: SelectionHistory = {
        async load() {
            return new Map();
        },
        recordSelection() {
            return;
        },
        async flush() {
            return;
        },
    };
    const getHistory = (): Promise<SelectionHistory> => {
        if (historyTask !== undefined) return historyTask;
        historyTask = import("./selection-history.ts")
            .then(({ createSelectionHistory }) => createSelectionHistory(options))
            .catch(() => {
                reportError();
                return unavailableHistory;
            });
        return historyTask;
    };

    return {
        async load() {
            return (await getHistory()).load();
        },
        recordSelection(name) {
            pendingRecords = pendingRecords.then(async () => {
                const history = await getHistory();
                history.recordSelection(name);
            });
        },
        async flush() {
            await pendingRecords;
            if (historyTask === undefined) return;
            await (await historyTask).flush();
        },
    };
}
