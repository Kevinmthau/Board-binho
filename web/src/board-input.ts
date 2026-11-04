import { Board, BoardContactPhase, BoardContactType, type BoardContact } from "@board.fun/web-sdk";

export type FingerTrace = {
  began: boolean;
  points: Array<{ x: number; y: number }>;
  terminal?: BoardContactPhase.Ended | BoardContactPhase.Canceled;
  releasePosition?: { x: number; y: number };
};

type ContactChange = {
  began: boolean;
  terminated: boolean;
  canceled: boolean;
  lastWasFinger: boolean;
  fingerTraces?: FingerTrace[];
};
export type BoardFrameChanges = ReadonlyMap<number, ContactChange>;

// Beta.6's subscriber supplies the live poses, but folds unreported contacts
// into Stationary and removes both terminal phases. Keep the native phase for
// this dispatch so the game can tell a release from a cancellation or a blink.
export function subscribeToBoardFrames(
  onFrame: (contacts: readonly BoardContact[], changes: BoardFrameChanges) => void,
): void {
  if (!Board.isOnDevice) return;
  const reported = new Map<number, ContactChange>();
  const subscribe = () => Board.input.subscribe((contacts) => onFrame(contacts, reported));
  const channel = window.boardTouch;
  if (!channel) {
    subscribe();
    return;
  }

  function record(id: number, phase: BoardContactPhase, finger: boolean, x: number, y: number): void {
    const previous = reported.get(id);
    const change: ContactChange = previous ?? { began: false, terminated: false, canceled: false, lastWasFinger: finger };
    let trace = change.fingerTraces?.[change.fingerTraces.length - 1];
    if (finger && phase !== BoardContactPhase.None) {
      if (!trace || trace.terminal || phase === BoardContactPhase.Began) {
        if (trace && !trace.terminal) trace.terminal = BoardContactPhase.Canceled;
        trace = { began: phase === BoardContactPhase.Began || previous?.lastWasFinger === false, points: [] };
        (change.fingerTraces ??= []).push(trace);
      }
      if (phase === BoardContactPhase.Ended || phase === BoardContactPhase.Canceled) {
        trace.terminal = phase;
        if (phase === BoardContactPhase.Ended && Number.isFinite(x) && Number.isFinite(y)) trace.releasePosition = { x, y };
      } else {
        trace.points.push({ x, y });
      }
    } else if (trace && !trace.terminal) {
      trace.terminal = BoardContactPhase.Canceled;
    }
    change.lastWasFinger = finger;
    change.began ||= phase === BoardContactPhase.Began;
    change.terminated ||= phase === BoardContactPhase.Ended || phase === BoardContactPhase.Canceled;
    change.canceled = phase === BoardContactPhase.Canceled;
    reported.set(id, change);
  }

  function observe(dispatch: (event: MessageEvent) => void) {
    return (event: MessageEvent) => {
      try {
        if (typeof event.data === "string") {
          for (const { id, p, t, g, x, y } of JSON.parse(event.data).c ?? []) {
            record(id, p, t === BoardContactType.Finger && g === 0, x, y);
          }
        } else if (event.data instanceof ArrayBuffer) {
          // Beta.6 binary layout: 12-byte header, 36-byte contact records.
          const view = new DataView(event.data);
          const count = view.getInt32(8, true);
          for (let i = 0; i < count; i++) {
            const offset = 12 + i * 36;
            const finger = view.getInt32(offset + 16, true) === BoardContactType.Finger && view.getInt32(offset + 24, true) === 0;
            record(view.getInt32(offset, true), view.getInt32(offset + 20, true), finger,
              view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true));
          }
        }
        dispatch.call(channel, event);
      } finally {
        reported.clear();
      }
    };
  }

  const descriptor = Object.getOwnPropertyDescriptor(channel, "onmessage");
  if (descriptor?.set && descriptor.configurable) {
    // Studio's getter returns a dispatcher that calls its latest assigned
    // listener. Wrapping that getter's result would make it call itself.
    // Observe the SDK handler as it is assigned, before the host wraps it.
    const set = descriptor.set;
    Object.defineProperty(channel, "onmessage", {
      ...descriptor,
      set(handler) { set.call(this, typeof handler === "function" ? observe(handler) : handler); },
    });
    try {
      subscribe();
    } finally {
      Object.defineProperty(channel, "onmessage", descriptor);
    }
  } else {
    subscribe();
    const dispatch = channel.onmessage;
    if (dispatch) channel.onmessage = observe(dispatch);
  }
}
