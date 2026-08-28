# Pi Extension Internals

Shared composition protocols and guarded Pi-internal loading for extensions that patch the same Pi UI internals.

## Install

```sh
npm install @zigai/pi-extension-internals
```

Declare the exact supported version in `dependencies`. Keep Pi host packages in `peerDependencies`.

## API

- `registerEditorEnhancer` composes keyed editor transformations.
- `installLinkedMethodPatch` and `installLinkedRenderPatch` install removable method patches.
- `installKeyedLinkedMethodPatch` updates an existing keyed patch instead of stacking another wrapper.
- `loadPiInternalModule` imports and validates a Pi-internal module, returning `undefined` with a scoped warning when unavailable.

Use `Symbol.for(...)` for enhancer keys and patch markers so independently installed extensions share the same registration.

## License

MIT
