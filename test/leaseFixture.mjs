// View-state tests stub transport ownership; lease transport/race tests exercise the real controller.
export function testLease(onChange = () => {}, { held = true } = {}) {
  let proof = held ? "test-edit-proof" : undefined, generation = 0;
  const lease = { state: { status: held ? "held" : "idle" },
    get proof() { return proof; },
    capture: () => generation,
    requireProof() { if (!proof) throw new Error("test lease lost"); return proof; },
    async acquire() { generation++; proof = "test-edit-proof"; lease.state = { status: "held" }; onChange(lease.state); return proof; },
    release(ticket) { if (ticket !== undefined && ticket !== generation) return; generation++; proof = undefined; lease.state = { status: "idle" }; onChange(lease.state); },
    invalidate(error) { proof = undefined; lease.state = { status: "lost", error }; onChange(lease.state); },
  };
  return lease;
}

export function leaseReply(input) {
  return { lease: { id: input.id, scope: input.scope || "content", owner: { id: "employee", name: "测试员工" },
    expiresAt: new Date(Date.now() + 20000).toISOString(), ...(input.action === "lease-acquire" ? { token: "test-edit-proof" } : {}) }, ttlSeconds: 20 };
}
