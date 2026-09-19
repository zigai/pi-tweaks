export type MouseInputEvent = {
    type: "press" | "release" | "move" | "drag" | "click" | "wheel";
    button: "left" | "middle" | "right" | "none";
    x: number;
    y: number;
    screenX: number;
    screenY: number;
    width: number;
    height: number;
    shift: boolean;
    alt: boolean;
    ctrl: boolean;
    wheelDelta?: number;
    clickCount?: number;
};

export type MouseInputResult = {
    handled?: boolean;
    capture?: boolean;
    focus?: boolean;
    render?: boolean;
};
