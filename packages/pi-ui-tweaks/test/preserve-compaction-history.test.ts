import assert from "node:assert/strict";
import { test } from "vitest";

import { installPreserveCompactionHistoryPatch } from "../src/preserve-compaction-history.ts";

class FakeInteractiveMode {
    clearCount = 0;
    rebuildCount = 0;
    summaryCount = 0;
    chatContainer = {
        clear: () => {
            this.clearCount += 1;
        },
    };

    async handleEvent(event: unknown): Promise<void> {
        if (
            typeof event === "object" &&
            event !== null &&
            Reflect.get(event, "type") === "compaction_end" &&
            Reflect.get(event, "result") !== undefined
        ) {
            this.chatContainer.clear();
            this.rebuildChatFromMessages();
            this.summaryCount += 1;
        }
    }

    rebuildChatFromMessages(): void {
        this.rebuildCount += 1;
    }
}

test("preserve compaction history leaves successful live compaction UI intact", async () => {
    installPreserveCompactionHistoryPatch(
        { preserveCompactionHistory: true },
        FakeInteractiveMode.prototype,
    );

    const mode = new FakeInteractiveMode();
    await mode.handleEvent({ type: "compaction_end", aborted: false, result: {} });

    assert.equal(mode.clearCount, 0);
    assert.equal(mode.rebuildCount, 0);
    assert.equal(mode.summaryCount, 1);
    installPreserveCompactionHistoryPatch(
        { preserveCompactionHistory: false },
        FakeInteractiveMode.prototype,
    );
});

test("preserve compaction history keeps Pi's normal redraw when disabled", async () => {
    installPreserveCompactionHistoryPatch(
        { preserveCompactionHistory: false },
        FakeInteractiveMode.prototype,
    );

    const mode = new FakeInteractiveMode();
    await mode.handleEvent({ type: "compaction_end", aborted: false, result: {} });

    assert.equal(mode.clearCount, 1);
    assert.equal(mode.rebuildCount, 1);
    assert.equal(mode.summaryCount, 1);
    installPreserveCompactionHistoryPatch(
        { preserveCompactionHistory: false },
        FakeInteractiveMode.prototype,
    );
});
