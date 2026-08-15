# Pi Extension Internals

Shared runtime composition protocols and guarded Pi-internal loading for Pi extensions.

Use this package when independently installed extensions must patch the same editor or prototype method without overwriting one another. It is intentionally narrow: it is not a general-purpose utility package and does not make Pi's private modules stable.

## Install

```sh
npm install @zigai/pi-extension-internals
```

Extensions that use these protocols at runtime should declare the exact supported version and bundle it into their package:

```json
{
  "dependencies": {
    "@zigai/pi-extension-internals": "0.1.0"
  },
  "bundleDependencies": ["@zigai/pi-extension-internals"]
}
```

## Editor enhancers

`registerEditorEnhancer` composes editor factories in registration order. A later registration with the same key updates that slot without moving it.

```ts
import { registerEditorEnhancer } from "@zigai/pi-extension-internals";

const handle = registerEditorEnhancer(
  ctx,
  Symbol.for("example.extension.editor-enhancer"),
  createDefaultEditor,
  (editor) => enhanceEditor(editor),
);

handle.update((editor) => enhanceEditorWithNewSettings(editor));
handle.dispose();
```

Keys must come from `Symbol.for(...)` so reloads and separately bundled package copies identify the same registration. The first registry creator owns the fallback editor factory; later extensions cannot silently replace it.

## Linked method patches

`installLinkedMethodPatch` and `installLinkedRenderPatch` keep predecessor links live, so patches can be removed in any order without leaving stale closures.

Use `installKeyedLinkedMethodPatch` for a feature that may install again after reload or settings changes:

```ts
import { installKeyedLinkedMethodPatch } from "@zigai/pi-extension-internals";

const patch = installKeyedLinkedMethodPatch(
  prototype,
  "render",
  Symbol.for("example.extension.render-patch"),
  settings,
  (predecessor, getSettings) =>
    function (width) {
      return transform(predecessor.call(this, width), getSettings());
    },
);

patch.update(nextSettings);
patch.dispose();
```

A keyed reinstall updates and returns the existing handle rather than stacking another wrapper. Patch transforms must return extensible functions because the protocol stores cross-copy linkage metadata on them.

## Guarded Pi-internal loading

`loadPiInternalModule` resolves a path relative to Pi's installed entry module, imports it, and passes the unknown module namespace to a required parser. Missing modules, rejected shapes, and parser failures return `undefined` and emit one scoped warning.

```ts
const component = await loadPiInternalModule("modes/interactive/example.js", {
  scope: "example-extension",
  feature: "example component",
  parse: parseExampleComponent,
});
```

Keep parsing at this boundary. Do not cast private Pi exports in feature code.

## Compatibility and ownership

The editor and linked-patch protocols carry runtime version metadata and reject incompatible copies before mutating shared state. Unversioned registries and patch links created by `0.1.0` are accepted as protocol version 1 for compatibility with already loaded extensions.

Every registration or patch has an owner. Retain its handle, update it when the same feature is reconfigured, and call `dispose()` during the owning extension's cleanup path. Public exports are limited to the composition protocols, their contract types, `loadPiInternalModule`, and scoped warning formatting.

## License

MIT
