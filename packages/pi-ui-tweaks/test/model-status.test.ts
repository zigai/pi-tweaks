import assert from "node:assert/strict";
import { test } from "vitest";

import { installModelStatusPatch } from "../src/model-status.ts";

function statusMode() {
    const renderRequests: Array<boolean | undefined> = [];
    return {
        renderRequests,
        statuses: [] as string[],
        showStatus(message: string): void {
            this.statuses.push(message);
        },
        ui: {
            requestRender(force?: boolean): void {
                renderRequests.push(force);
            },
        },
    };
}

test("model-change status suppression updates without stacking", () => {
    const target = statusMode();
    const handle = installModelStatusPatch({ hideModelChangeStatus: true }, target);
    const patched = Reflect.get(target, "showStatus");
    installModelStatusPatch({ hideModelChangeStatus: false }, target);
    assert.equal(Reflect.get(target, "showStatus"), patched);
    target.showStatus("Model: deepseek-v4-flash");
    assert.deepEqual(target.statuses, ["Model: deepseek-v4-flash"]);

    handle.update({ hideModelChangeStatus: true });
    target.showStatus("Model: gpt-5");
    assert.deepEqual(target.statuses, ["Model: deepseek-v4-flash"]);
    assert.deepEqual(target.renderRequests, [undefined]);
    handle.dispose();
});
