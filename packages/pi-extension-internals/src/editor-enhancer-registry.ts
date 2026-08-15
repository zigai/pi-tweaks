export type EditorFactory<Args extends readonly unknown[], Editor> = (...args: Args) => Editor;

export type EditorEnhancer<Args extends readonly unknown[], Editor> = (
    editor: Editor,
    ...args: Args
) => Editor;

export type EditorEnhancerContext<Args extends readonly unknown[], Editor> = {
    readonly hasUI: boolean;
    readonly ui: {
        getEditorComponent(): EditorFactory<Args, Editor> | undefined;
        setEditorComponent(factory: EditorFactory<Args, Editor> | undefined): void;
    };
};

export type EditorEnhancerHandle<Args extends readonly unknown[], Editor> = {
    update(enhancer: EditorEnhancer<Args, Editor>): void;
    dispose(): void;
};

const EDITOR_ENHANCER_PROTOCOL_VERSION = 1;
const EDITOR_ENHANCER_PROTOCOL = Symbol.for("zigai.pi-tweaks.editor-enhancer-protocol-version");

const EDITOR_ENHANCER_REGISTRY = Symbol.for("zigai.pi-tweaks.editor-enhancer-registry");
const EDITOR_ENHANCER_FACTORY = Symbol.for("zigai.pi-tweaks.editor-enhancer-factory");

type EnhancerEntry<Args extends readonly unknown[], Editor> = {
    enhancer: EditorEnhancer<Args, Editor>;
};

type EditorEnhancerRegistry<Args extends readonly unknown[], Editor> = {
    readonly [EDITOR_ENHANCER_PROTOCOL]: typeof EDITOR_ENHANCER_PROTOCOL_VERSION;
    baseFactory: EditorFactory<Args, Editor> | undefined;
    readonly defaultFactory: EditorFactory<Args, Editor>;
    readonly enhancers: Map<PropertyKey, EnhancerEntry<Args, Editor>>;
    readonly factory: EditorFactory<Args, Editor>;
};

/**
 * Shared symbol properties may have been written by another bundled package version.
 * Only own data properties participate in the protocol; their values stay unknown until parsed.
 */
function readOwnDataProperty(target: object, key: PropertyKey): unknown {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) return undefined;
    const value: unknown = descriptor.value;
    return value;
}

function formatProtocolVersion(version: unknown): string {
    if (typeof version === "number") return version.toString();
    return `invalid-${typeof version}`;
}

function isLegacyEnhancerKey(value: unknown): value is PropertyKey {
    return typeof value === "string" || typeof value === "number" || typeof value === "symbol";
}

function hasValidEnhancerEntries(value: unknown, legacy: boolean): boolean {
    if (!(value instanceof Map)) return false;
    const entries: ReadonlyMap<unknown, unknown> = value;
    for (const [key, entry] of entries) {
        if (legacy) {
            if (!isLegacyEnhancerKey(key)) return false;
        } else if (typeof key !== "symbol" || Symbol.keyFor(key) === undefined) {
            return false;
        }
        if (typeof entry !== "object" || entry === null) return false;
        if (typeof readOwnDataProperty(entry, "enhancer") !== "function") return false;
    }
    return true;
}

function readRegistry<Args extends readonly unknown[], Editor>(
    ui: EditorEnhancerContext<Args, Editor>["ui"],
): EditorEnhancerRegistry<Args, Editor> | undefined {
    const value = readOwnDataProperty(ui, EDITOR_ENHANCER_REGISTRY);
    if (value === undefined) return undefined;
    if (typeof value !== "object" || value === null) {
        throw new TypeError("Incompatible editor enhancer registry");
    }

    const version = readOwnDataProperty(value, EDITOR_ENHANCER_PROTOCOL);
    if (version !== undefined && version !== EDITOR_ENHANCER_PROTOCOL_VERSION) {
        throw new TypeError(
            `Unsupported editor enhancer protocol version ${formatProtocolVersion(version)}`,
        );
    }
    const baseFactory = readOwnDataProperty(value, "baseFactory");
    const defaultFactory = readOwnDataProperty(value, "defaultFactory");
    const enhancers = readOwnDataProperty(value, "enhancers");
    const factory = readOwnDataProperty(value, "factory");
    if (
        (baseFactory !== undefined && typeof baseFactory !== "function") ||
        typeof defaultFactory !== "function" ||
        !hasValidEnhancerEntries(enhancers, version === undefined) ||
        typeof factory !== "function" ||
        readOwnDataProperty(factory, EDITOR_ENHANCER_FACTORY) !== true
    ) {
        throw new TypeError("Incompatible editor enhancer registry");
    }
    if (
        version === undefined &&
        !Reflect.defineProperty(value, EDITOR_ENHANCER_PROTOCOL, {
            configurable: true,
            value: EDITOR_ENHANCER_PROTOCOL_VERSION,
        })
    ) {
        throw new TypeError("Unable to mark legacy editor enhancer registry as protocol v1");
    }

    // SAFETY: The checks above validate every runtime field shared between independently
    // bundled protocol copies. Generic arguments are fixed by the owning Pi UI instance.
    return value as EditorEnhancerRegistry<Args, Editor>;
}

function markSharedFactory<Args extends readonly unknown[], Editor>(
    factory: EditorFactory<Args, Editor>,
): void {
    if (
        !Reflect.defineProperty(factory, EDITOR_ENHANCER_FACTORY, {
            value: true,
        })
    ) {
        throw new TypeError("Unable to mark the shared editor enhancer factory");
    }
}

function isCurrentSharedFactory<Args extends readonly unknown[], Editor>(
    factory: EditorFactory<Args, Editor> | undefined,
    registry: EditorEnhancerRegistry<Args, Editor>,
): boolean {
    return (
        factory !== undefined &&
        factory === registry.factory &&
        readOwnDataProperty(factory, EDITOR_ENHANCER_FACTORY) === true
    );
}

function activateRegistry<Args extends readonly unknown[], Editor>(
    ui: EditorEnhancerContext<Args, Editor>["ui"],
    registry: EditorEnhancerRegistry<Args, Editor>,
): void {
    const current = ui.getEditorComponent();
    if (isCurrentSharedFactory(current, registry)) {
        return;
    }

    registry.baseFactory = current;
    ui.setEditorComponent(registry.factory);
}

/**
 * Registers one keyed editor transformation in the shared editor factory stack.
 *
 * The key must come from `Symbol.for(...)` so independently bundled copies and extension
 * reloads replace the same registration. The first registration owns the fallback factory;
 * later registrations compose enhancers without changing that fallback.
 */
export function registerEditorEnhancer<Args extends readonly unknown[], Editor>(
    ctx: EditorEnhancerContext<Args, Editor>,
    key: symbol,
    createDefaultEditor: EditorFactory<Args, Editor>,
    enhancer: EditorEnhancer<Args, Editor>,
): EditorEnhancerHandle<Args, Editor> {
    if (typeof key !== "symbol" || Symbol.keyFor(key) === undefined) {
        throw new TypeError("Editor enhancer keys must be created with Symbol.for(...)");
    }
    if (!ctx.hasUI) {
        return {
            update() {},
            dispose() {},
        };
    }

    let created = false;
    let registry = readRegistry(ctx.ui);
    if (registry === undefined) {
        const enhancers = new Map<PropertyKey, EnhancerEntry<Args, Editor>>();
        const createdRegistry: EditorEnhancerRegistry<Args, Editor> = {
            [EDITOR_ENHANCER_PROTOCOL]: EDITOR_ENHANCER_PROTOCOL_VERSION,
            baseFactory: ctx.ui.getEditorComponent(),
            defaultFactory: createDefaultEditor,
            enhancers,
            factory: (...args: Args): Editor => {
                let editor =
                    createdRegistry.baseFactory?.(...args) ??
                    createdRegistry.defaultFactory(...args);
                for (const entry of enhancers.values()) {
                    editor = entry.enhancer(editor, ...args);
                }
                return editor;
            },
        };
        markSharedFactory(createdRegistry.factory);
        if (
            !Reflect.defineProperty(ctx.ui, EDITOR_ENHANCER_REGISTRY, {
                configurable: true,
                value: createdRegistry,
            })
        ) {
            throw new TypeError("Unable to store the editor enhancer registry");
        }
        registry = createdRegistry;
        created = true;
    }

    try {
        activateRegistry(ctx.ui, registry);
    } catch (cause: unknown) {
        if (
            created &&
            readOwnDataProperty(ctx.ui, EDITOR_ENHANCER_REGISTRY) === registry &&
            !Reflect.deleteProperty(ctx.ui, EDITOR_ENHANCER_REGISTRY)
        ) {
            throw new TypeError("Unable to roll back the editor enhancer registry", { cause });
        }
        if (cause instanceof Error) {
            throw cause;
        }
        throw new Error("Unable to activate the editor enhancer registry", { cause });
    }

    const entry: EnhancerEntry<Args, Editor> = { enhancer };
    registry.enhancers.set(key, entry);
    let disposed = false;

    return {
        update(nextEnhancer): void {
            if (disposed || registry.enhancers.get(key) !== entry) {
                return;
            }
            entry.enhancer = nextEnhancer;
            activateRegistry(ctx.ui, registry);
        },
        dispose(): void {
            if (disposed) {
                return;
            }
            if (registry.enhancers.get(key) !== entry) {
                disposed = true;
                return;
            }

            if (registry.enhancers.size !== 1) {
                registry.enhancers.delete(key);
                disposed = true;
                return;
            }

            if (isCurrentSharedFactory(ctx.ui.getEditorComponent(), registry)) {
                ctx.ui.setEditorComponent(registry.baseFactory);
            }
            if (
                readOwnDataProperty(ctx.ui, EDITOR_ENHANCER_REGISTRY) === registry &&
                !Reflect.deleteProperty(ctx.ui, EDITOR_ENHANCER_REGISTRY)
            ) {
                throw new TypeError("Unable to remove the editor enhancer registry");
            }
            registry.enhancers.delete(key);
            disposed = true;
        },
    };
}
