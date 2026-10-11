// Keeps the screen on while recording. Unsupported browsers just skip it.
// The browser drops the lock when the page is hidden, so re-request it on return.

let sentinel: WakeLockSentinel | null = null;
let wanted = false;

async function request(): Promise<boolean> {
  try {
    if (!("wakeLock" in navigator)) return false;
    sentinel = await navigator.wakeLock.request("screen");
    sentinel.addEventListener("release", () => {
      sentinel = null;
    });
    return true;
  } catch {
    return false;
  }
}

function onVisibility() {
  if (wanted && document.visibilityState === "visible" && !sentinel) void request();
}

/** Returns false if the browser doesn't support or refused the lock. */
export async function acquireWakeLock(): Promise<boolean> {
  wanted = true;
  document.addEventListener("visibilitychange", onVisibility);
  return request();
}

export async function releaseWakeLock(): Promise<void> {
  wanted = false;
  document.removeEventListener("visibilitychange", onVisibility);
  try {
    await sentinel?.release();
  } catch {
    // already released
  }
  sentinel = null;
}
