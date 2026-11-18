import { createHmac, randomBytes } from "node:crypto";
import { localPage } from "./process.mjs";

const nonce = () => randomBytes(24).toString("hex");
const sign = (key, id, url, challenge) =>
  createHmac("sha256", key).update(JSON.stringify([id, url, challenge])).digest("hex");

export function createOwner(port, principal, ipv6) {
  if (port && principal) return { port, principal, ipv6, key: nonce() };
}

// Only a live manager holding the original session can answer a fresh challenge.
export function ownerProof(sessions, id, challenge) {
  if (!/^[a-f0-9]{48}$/.test(challenge)) return;
  for (const session of sessions.values()) {
    if (session.id === id && session.owner && session.state === "running")
      return sign(session.owner.key, id, session.url, challenge);
  }
}

export async function peerSession(record, principal) {
  const owner = record?.owner;
  const session = record?.lastSession;
  if (session?.state !== "running" || !owner?.key || !principal || owner.principal !== principal ||
      !Number.isInteger(owner.port) || owner.port < 1 || owner.port > 65535) return;
  try {
    const url = localPage(session.url);
    const challenge = nonce();
    const query = new URLSearchParams({ id: session.id, challenge });
    const host = owner.ipv6 ? "[::1]" : "127.0.0.1";
    const response = await fetch(`http://${host}:${owner.port}/ui/skill-owner?${query}`, {
      redirect: "error", signal: AbortSignal.timeout(1200),
    });
    // Proof is a response header. Never load another local application's body.
    await response.body?.cancel();
    if (response.ok && response.headers.get("X-Skill-Proof") === sign(owner.key, session.id, url, challenge))
      return { id: session.id, url, state: "running", ownerPort: owner.port };
  } catch { /* Unreachable or unverified sessions keep their existing recovery path. */ }
}
