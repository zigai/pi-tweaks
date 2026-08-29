import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";

import assistantRenderingExtension from "../src/index.ts";

type AssistantComponent = {
    render(width: number): string[];
};

type AssistantConstructor = {
    new (): AssistantComponent;
    readonly prototype: {
        render(width: number): string[];
        updateContent(): void;
    };
};

type ParsedAssistantModule = {
    readonly AssistantMessageComponent: AssistantConstructor;
};

function isAssistantModule(module: unknown): module is ParsedAssistantModule {
    if (typeof module !== "object" || module === null) return false;
    if (!("AssistantMessageComponent" in module)) return false;
    const component = module.AssistantMessageComponent;
    if (typeof component !== "function" || !("prototype" in component)) return false;
    const prototype: unknown = component.prototype;
    if (typeof prototype !== "object" || prototype === null) return false;
    if (!("render" in prototype) || typeof prototype.render !== "function") return false;
    return "updateContent" in prototype && typeof prototype.updateContent === "function";
}

test("patches assistant Markdown owned by a separate running Pi installation", async ({
    onTestFinished,
}) => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "pi-response-host-"));
    const fixtureDirectory = join(
        fixtureRoot,
        "node_modules",
        "@earendil-works",
        "pi-coding-agent",
    );
    const bundleDirectory = join(fixtureDirectory, "dist", "bundle");
    const chunksDirectory = join(bundleDirectory, "chunks");
    const assistantDirectory = join(fixtureDirectory, "dist", "modes", "interactive", "components");
    const originalEntrypoint = process.argv[1];
    const originalPiFlag = process.env.PI_CODING_AGENT;
    const originalPackageDirectory = process.env.PI_PACKAGE_DIR;
    onTestFinished(async () => {
        process.argv[1] = originalEntrypoint;
        if (originalPiFlag === undefined) {
            delete process.env.PI_CODING_AGENT;
        } else {
            process.env.PI_CODING_AGENT = originalPiFlag;
        }
        if (originalPackageDirectory === undefined) {
            delete process.env.PI_PACKAGE_DIR;
        } else {
            process.env.PI_PACKAGE_DIR = originalPackageDirectory;
        }
        await rm(fixtureRoot, { recursive: true, force: true });
    });

    await mkdir(chunksDirectory, { recursive: true });
    await mkdir(assistantDirectory, { recursive: true });
    await writeFile(
        join(fixtureDirectory, "package.json"),
        '{"name":"@earendil-works/pi-coding-agent","type":"module"}\n',
    );
    const assistantSource = `class ForeignMarkdown {
    text = "fenced";
    theme = {};
    setText() {}
    invalidate() {}
    render() {
        const fence = String.fromCharCode(96).repeat(3);
        return ["\\u001b[90m" + fence + "json\\u001b[0m", '{"working":true}', "\\u001b[90m" + fence + "\\u001b[0m"];
    }
}
export class AssistantMessageComponent {
    contentContainer = {
        children: [],
        addChild(component) { this.children.push(component); },
    };
    constructor() { this.updateContent(); }
    updateContent() {
        this.contentContainer.children.length = 0;
        this.contentContainer.addChild(new ForeignMarkdown());
    }
    render(width) { return this.contentContainer.children.flatMap((child) => child.render(width)); }
}
`;
    const bundledAssistantModulePath = join(chunksDirectory, "runtime.js");
    const assistantModulePath = join(assistantDirectory, "assistant-message.js");
    await writeFile(bundledAssistantModulePath, assistantSource);
    await writeFile(assistantModulePath, assistantSource);
    await writeFile(
        join(bundleDirectory, "cli.js"),
        'import { AssistantMessageComponent } from "./chunks/runtime.js";\nvoid AssistantMessageComponent;\n',
    );

    process.argv[1] = join(bundleDirectory, "cli.js");
    process.env.PI_CODING_AGENT = "true";
    delete process.env.PI_PACKAGE_DIR;

    const imported: unknown = await import(pathToFileURL(bundledAssistantModulePath).href);
    if (!isAssistantModule(imported)) throw new TypeError("missing fixture assistant component");
    await assistantRenderingExtension();

    const component = new imported.AssistantMessageComponent();
    expect(component.render(80)).toEqual(['{"working":true}']);
});
