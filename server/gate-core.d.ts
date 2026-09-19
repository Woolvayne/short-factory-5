/**
 * Typdeklaration für server/gate-core.js (plain JS, von api/*.js und dem
 * Vite-Dev-Server geteilt).
 */
import type { IncomingMessage, ServerResponse } from "node:http";

/** Gesetztes Gate-Passwort (APP_PASSWORD) oder null = Gate aus. */
export function gatePassword(): string | null;
/** true, wenn APP_PASSWORD gesetzt ist. */
export function gateEnabled(): boolean;
/** Hat der Request eine gültige Gate-Session (Cookie)? */
export function cookieUnlocked(req: IncomingMessage): boolean;
/**
 * Guard für geschützte Routen: true = blockiert (401 bereits geschrieben),
 * false = offen bzw. entsperrt.
 */
export function gateBlocked(req: IncomingMessage, res: ServerResponse): boolean;
/** JSON-Antwort (funktioniert mit Vercel- und plain-node-Response). */
export function json(res: ServerResponse, code: number, payload: unknown): void;
/** Kompletter /api/gate-Handler (GET · POST · DELETE). */
export function handleGateRequest(req: IncomingMessage, res: ServerResponse): Promise<unknown>;
