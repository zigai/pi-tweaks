# Pi Loader Time

This Pi extension adds a running elapsed-time counter to Pi loader messages.

When an operation takes longer than expected, the loader shows how long it has been active, such as `Thinking (12s)` or `Running command (2m 05s)`.

## Install

```sh
pi install git:github.com/zigai/pi-ux-tweaks
```

The timer starts when a loader starts and is cleared when that loader stops. Durations are displayed in seconds, minutes, or hours depending on how long the loader has been running.
