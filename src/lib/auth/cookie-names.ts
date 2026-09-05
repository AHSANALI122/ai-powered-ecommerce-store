/**
 * Cookie and header names shared by server and browser code.
 *
 * Deliberately dependency-free: the client needs the CSRF cookie name, and
 * importing it from a module that also pulls in env parsing, node:crypto or
 * next/server would drag server-only code into the browser bundle.
 */

export const ACCESS_COOKIE = "at";
export const REFRESH_COOKIE = "rt";
export const CSRF_COOKIE = "csrf";
export const GUEST_COOKIE = "guestId";

/** Header the browser echoes the CSRF cookie back in (SEC-1). */
export const CSRF_HEADER = "x-csrf-token";
