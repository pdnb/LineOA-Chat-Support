'use client';

/**
 * Bridge to the Hotline desktop app (desktop/, Tauri). The app loads this console from the server and
 * injects `__TAURI_INTERNALS__`; the desktop only lets this server's origin call `notify` and `set_unread`.
 * In a normal browser every function here is a no-op.
 */
declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> };
  }
}

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
}

function invoke(cmd: string, args: Record<string, unknown>) {
  // Same call @tauri-apps/api's invoke() makes. A failure must never break the console.
  window.__TAURI_INTERNALS__?.invoke(cmd, args).catch((err) => console.warn(`[desktop] ${cmd} failed`, err));
}

/** Native toast; the app skips it while the agent is looking at the window. Clicking opens the chat. */
export function desktopNotify(title: string, body: string, conversationId: string) {
  invoke('notify', { title, body, conversationId });
}

/** Queue count shown on the taskbar icon and the tray. */
export function setDesktopUnread(count: number) {
  invoke('set_unread', { count });
}
