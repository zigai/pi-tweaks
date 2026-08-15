const PATCH_PREDECESSOR = Symbol.for("zigai.pi-tweaks.render-patch-predecessor");
const PATCH_PREDECESSOR_DESCRIPTOR = Symbol.for(
    "zigai.pi-tweaks.render-patch-predecessor-descriptor",
);

const PATCH_PROTOCOL_VERSION = 1;
const PATCH_PROTOCOL = Symbol.for("zigai.pi-tweaks.render-patch-protocol-version");

export type LinkedMethod<Instance, Args extends unknown[], Result> = (
    this: Instance,
    ...args: Args
) => Result;

export type LinkedMethodPatchHandle<Instance, Args extends unknown[], Result> = {
    /** The method immediately below this patch when it was installed. */
    readonly predecessor: LinkedMethod<Instance, Args, Result>;
    readonly patched: LinkedMethod<Instance, Args, Result>;
    dispose(): void;
};

/** Uses the target as `this` when a method does not declare an explicit receiver. */
type MethodInstance<Target, Method> = Method extends (
    this: infer Instance,
    ...args: infer _Args
) => infer _Result
    ? unknown extends Instance
        ? Target
        : Instance
    : never;

type MethodArgs<Method> = Method extends (
    this: infer _Instance,
    ...args: infer Args
) => infer _Result
    ? Args
    : never;

type MethodResult<Method> = Method extends (
    this: infer _Instance,
    ...args: infer _Args
) => infer Result
    ? Result
    : never;

type ExtractedLinkedMethod<Target, Method> = LinkedMethod<
    MethodInstance<Target, Method>,
    MethodArgs<Method>,
    MethodResult<Method>
>;

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

function readProperty(target: object, key: PropertyKey): unknown {
    const value: unknown = Reflect.get(target, key);
    return value;
}

function formatProtocolVersion(version: unknown): string {
    if (typeof version === "number") return version.toString();
    return `invalid-${typeof version}`;
}

function getLinkedPredecessor<Instance, Args extends unknown[], Result>(
    method: LinkedMethod<Instance, Args, Result>,
): LinkedMethod<Instance, Args, Result> | undefined {
    const version = readOwnDataProperty(method, PATCH_PROTOCOL);
    if (version !== undefined && version !== PATCH_PROTOCOL_VERSION) {
        throw new Error(
            `Unsupported linked method patch protocol version ${formatProtocolVersion(version)}`,
        );
    }
    const predecessor = readOwnDataProperty(method, PATCH_PREDECESSOR);
    if (typeof predecessor !== "function") {
        return undefined;
    }

    // SAFETY: installLinkedMethodPatch writes only a method with the same signature under
    // this process-wide symbol, and the runtime check proves the reflected value is callable.
    return predecessor as LinkedMethod<Instance, Args, Result>;
}

function getPredecessorDescriptor<Instance, Args extends unknown[], Result>(
    method: LinkedMethod<Instance, Args, Result>,
): PropertyDescriptor | undefined {
    const descriptor = readOwnDataProperty(method, PATCH_PREDECESSOR_DESCRIPTOR);
    if (descriptor === undefined) return undefined;
    if (typeof descriptor !== "object" || descriptor === null) {
        throw new Error("Linked method patch has invalid predecessor descriptor metadata");
    }
    return descriptor;
}

function clearLinkedMetadata(method: object): void {
    Reflect.deleteProperty(method, PATCH_PREDECESSOR);
    Reflect.deleteProperty(method, PATCH_PREDECESSOR_DESCRIPTOR);
    Reflect.deleteProperty(method, PATCH_PROTOCOL);
}

function defineLinkedMetadata<Instance, Args extends unknown[], Result>(
    method: LinkedMethod<Instance, Args, Result>,
    predecessor: LinkedMethod<Instance, Args, Result>,
    predecessorDescriptor: PropertyDescriptor | undefined,
    key: PropertyKey,
): void {
    const metadata: ReadonlyArray<readonly [symbol, PropertyDescriptor]> = [
        [PATCH_PREDECESSOR, { configurable: true, value: predecessor, writable: true }],
        [
            PATCH_PREDECESSOR_DESCRIPTOR,
            { configurable: true, value: predecessorDescriptor, writable: true },
        ],
        [PATCH_PROTOCOL, { configurable: true, value: PATCH_PROTOCOL_VERSION }],
    ];
    for (const [metadataKey, descriptor] of metadata) {
        if (!Reflect.defineProperty(method, metadataKey, descriptor)) {
            clearLinkedMetadata(method);
            throw new TypeError(`Unable to attach linked patch metadata for ${String(key)}`);
        }
    }
}

function updateLinkedPredecessor<Instance, Args extends unknown[], Result>(
    method: LinkedMethod<Instance, Args, Result>,
    predecessor: LinkedMethod<Instance, Args, Result>,
    predecessorDescriptor: PropertyDescriptor | undefined,
): void {
    if (
        !Reflect.set(method, PATCH_PREDECESSOR, predecessor) ||
        !Reflect.set(method, PATCH_PREDECESSOR_DESCRIPTOR, predecessorDescriptor)
    ) {
        throw new Error("Unable to rewire linked method patch predecessor");
    }
}

/**
 * Installs one removable method transform whose predecessor remains dynamically linked.
 *
 * This low-level operation intentionally installs a new layer on every call. Use
 * `installKeyedLinkedMethodPatch` when an extension needs idempotent reload behavior.
 * Independent layers may be disposed in any order without retaining stale closures.
 */
export function installLinkedMethodPatch<Target extends object, Key extends keyof Target>(
    target: Target,
    key: Key,
    transform: (
        predecessor: ExtractedLinkedMethod<Target, Target[Key]>,
    ) => ExtractedLinkedMethod<Target, Target[Key]>,
): LinkedMethodPatchHandle<
    MethodInstance<Target, Target[Key]>,
    MethodArgs<Target[Key]>,
    MethodResult<Target[Key]>
> {
    type Instance = MethodInstance<Target, Target[Key]>;
    type Args = MethodArgs<Target[Key]>;
    type Result = MethodResult<Target[Key]>;
    type Method = LinkedMethod<Instance, Args, Result>;

    const candidate = readProperty(target, key);
    if (typeof candidate !== "function") {
        throw new TypeError(`Unable to patch non-function property ${String(key)}`);
    }

    // SAFETY: Target[Key] determines Method's this, arguments, and result types, while the
    // runtime check proves the indexed value is callable. TypeScript cannot retain that
    // conditional relationship after narrowing an indexed generic property.
    const original = candidate as Method;
    const originalDescriptor = Object.getOwnPropertyDescriptor(target, key);
    let patched: Method;
    const dynamicPredecessor: Method = function (this: Instance, ...args: Args): Result {
        const predecessor = getLinkedPredecessor(patched);
        if (predecessor === undefined) {
            throw new Error("Linked method patch lost its predecessor");
        }
        return predecessor.apply(this, args);
    };

    const transformed: unknown = transform(dynamicPredecessor);
    if (typeof transformed !== "function") {
        throw new TypeError(`Method transform for ${String(key)} returned a non-function`);
    }
    // SAFETY: The public transform contract returns the exact method extracted from Target[Key],
    // and the runtime check proves the boundary value is callable. TypeScript does not normalize
    // that conditional return type to this function body's equivalent local Method alias.
    patched = transformed as Method;
    if (
        patched === original ||
        Object.hasOwn(patched, PATCH_PREDECESSOR) ||
        Object.hasOwn(patched, PATCH_PREDECESSOR_DESCRIPTOR) ||
        Object.hasOwn(patched, PATCH_PROTOCOL)
    ) {
        throw new TypeError(`Method transform for ${String(key)} returned an installed method`);
    }
    if (!Object.isExtensible(patched)) {
        throw new TypeError(
            `Method transform for ${String(key)} returned a non-extensible function`,
        );
    }
    defineLinkedMetadata(patched, original, originalDescriptor, key);
    let installed = false;
    try {
        installed = Reflect.set(target, key, patched) && readProperty(target, key) === patched;
    } finally {
        if (!installed) {
            clearLinkedMetadata(patched);
        }
    }
    if (!installed) {
        throw new TypeError(`Unable to patch method ${String(key)}`);
    }

    let disposed = false;
    return {
        predecessor: original,
        patched,
        dispose(): void {
            if (disposed) return;

            const predecessor = getLinkedPredecessor(patched);
            if (predecessor === undefined) {
                throw new Error("Linked method patch lost its predecessor");
            }
            const predecessorDescriptor = getPredecessorDescriptor(patched);

            if (Reflect.get(target, key) === patched) {
                let restored: boolean;
                if (predecessorDescriptor === undefined) {
                    restored = Reflect.deleteProperty(target, key);
                } else {
                    restored = Reflect.defineProperty(target, key, predecessorDescriptor);
                }
                if (!restored) {
                    throw new Error(`Unable to restore method ${String(key)}`);
                }
                disposed = true;
                return;
            }

            const installed = readProperty(target, key);
            if (typeof installed !== "function") {
                disposed = true;
                return;
            }
            // SAFETY: A callable value at the patched key participates in the linked-method
            // protocol only through getLinkedPredecessor's symbol validation. This cast lets
            // that validation preserve Method's signature across the dynamically linked chain.
            let current = installed as Method;
            const visited = new Set<Method>();
            while (true) {
                if (visited.has(current)) {
                    throw new Error(
                        `Unable to dispose cyclic method patch chain for ${String(key)}`,
                    );
                }
                visited.add(current);
                const next = getLinkedPredecessor(current);
                if (next === undefined) {
                    disposed = true;
                    return;
                }
                if (next === patched) {
                    updateLinkedPredecessor(current, predecessor, predecessorDescriptor);
                    disposed = true;
                    return;
                }
                current = next;
            }
        },
    };
}

const KEYED_PATCH_PROTOCOL_VERSION = 1;
const KEYED_PATCH_PROTOCOL = Symbol.for("zigai.pi-tweaks.keyed-method-patch-protocol-version");

export type KeyedLinkedMethodPatchHandle<
    Policy,
    Instance,
    Args extends unknown[],
    Result,
> = LinkedMethodPatchHandle<Instance, Args, Result> & {
    update(policy: Policy): void;
};

type KeyedPatchRecord<Policy, Instance, Args extends unknown[], Result> = {
    readonly [KEYED_PATCH_PROTOCOL]: typeof KEYED_PATCH_PROTOCOL_VERSION;
    readonly methodKey: PropertyKey;
    readonly handle: KeyedLinkedMethodPatchHandle<Policy, Instance, Args, Result>;
};

function readKeyedPatchHandle<Policy, Instance, Args extends unknown[], Result>(
    value: unknown,
    methodKey: PropertyKey,
): KeyedLinkedMethodPatchHandle<Policy, Instance, Args, Result> {
    if (typeof value !== "object" || value === null) {
        throw new TypeError("Incompatible keyed method patch record");
    }
    const version = readOwnDataProperty(value, KEYED_PATCH_PROTOCOL);
    if (version !== KEYED_PATCH_PROTOCOL_VERSION) {
        throw new TypeError(
            `Unsupported keyed method patch protocol version ${formatProtocolVersion(version)}`,
        );
    }
    if (readOwnDataProperty(value, "methodKey") !== methodKey) {
        throw new TypeError("Keyed method patch marker is already used for another method");
    }
    const handle = readOwnDataProperty(value, "handle");
    if (
        typeof handle !== "object" ||
        handle === null ||
        typeof readOwnDataProperty(handle, "predecessor") !== "function" ||
        typeof readOwnDataProperty(handle, "patched") !== "function" ||
        typeof readOwnDataProperty(handle, "update") !== "function" ||
        typeof readOwnDataProperty(handle, "dispose") !== "function"
    ) {
        throw new TypeError("Incompatible keyed method patch handle");
    }
    // SAFETY: The shared record version and complete callable handle shape were validated.
    return handle as KeyedLinkedMethodPatchHandle<Policy, Instance, Args, Result>;
}

/**
 * Installs or updates one globally keyed linked method patch.
 *
 * The marker must come from `Symbol.for(...)`. Reinstalling the same marker updates its policy
 * without adding another method layer, including when another bundled package copy installed it.
 */
export function installKeyedLinkedMethodPatch<
    Target extends object,
    Key extends keyof Target,
    Policy,
>(
    target: Target,
    key: Key,
    marker: symbol,
    initialPolicy: Policy,
    transform: (
        predecessor: ExtractedLinkedMethod<Target, Target[Key]>,
        getPolicy: () => Policy,
    ) => ExtractedLinkedMethod<Target, Target[Key]>,
): KeyedLinkedMethodPatchHandle<
    Policy,
    MethodInstance<Target, Target[Key]>,
    MethodArgs<Target[Key]>,
    MethodResult<Target[Key]>
> {
    if (typeof marker !== "symbol" || Symbol.keyFor(marker) === undefined) {
        throw new TypeError("Keyed method patch markers must be created with Symbol.for(...)");
    }

    type Instance = MethodInstance<Target, Target[Key]>;
    type Args = MethodArgs<Target[Key]>;
    type Result = MethodResult<Target[Key]>;
    const installed = readOwnDataProperty(target, marker);
    if (installed !== undefined) {
        const handle = readKeyedPatchHandle<Policy, Instance, Args, Result>(installed, key);
        handle.update(initialPolicy);
        return handle;
    }

    let currentPolicy = initialPolicy;
    const patch = installLinkedMethodPatch(target, key, (predecessor) =>
        transform(predecessor, () => currentPolicy),
    );
    let disposed = false;
    let record: KeyedPatchRecord<Policy, Instance, Args, Result>;
    const handle: KeyedLinkedMethodPatchHandle<Policy, Instance, Args, Result> = {
        predecessor: patch.predecessor,
        patched: patch.patched,
        update(policy): void {
            if (!disposed) currentPolicy = policy;
        },
        dispose(): void {
            if (disposed) return;
            patch.dispose();
            if (
                readOwnDataProperty(target, marker) === record &&
                !Reflect.deleteProperty(target, marker)
            ) {
                throw new TypeError(`Unable to remove keyed method patch ${String(marker)}`);
            }
            disposed = true;
        },
    };
    record = {
        [KEYED_PATCH_PROTOCOL]: KEYED_PATCH_PROTOCOL_VERSION,
        methodKey: key,
        handle,
    };
    if (
        !Reflect.defineProperty(target, marker, {
            configurable: true,
            value: record,
        })
    ) {
        patch.dispose();
        throw new TypeError(`Unable to store keyed method patch ${String(marker)}`);
    }
    return handle;
}

export function installLinkedRenderPatch<Target extends object & { render: unknown }>(
    target: Target,
    transform: (
        predecessor: ExtractedLinkedMethod<Target, Target["render"]>,
    ) => ExtractedLinkedMethod<Target, Target["render"]>,
): LinkedMethodPatchHandle<
    MethodInstance<Target, Target["render"]>,
    MethodArgs<Target["render"]>,
    MethodResult<Target["render"]>
> {
    return installLinkedMethodPatch(target, "render", transform);
}
