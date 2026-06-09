import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { resolveRecipientDetailed } from "./resolveRecipient.js";
import { DisabledQieResolverAdapter, CustomQieResolverAdapter } from "./resolverAdapter.js";
import type { QieDomainResolverAdapter } from "./types.js";

const REGISTRY = "0x00000000000000000000000000000000000000aa" as Address;
const ALICE = "0x1111111111111111111111111111111111111111" as Address;
const DESIGNER = "0x2222222222222222222222222222222222222222" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

const contracts = { usernameRegistry: "0x00000000000000000000000000000000000000bb" as Address };
const now = (): number => 1_700_000_000_000;

/** Minimal readContract mock routed by function name. */
function mockClient(handlers: {
  resolve?: (name: string) => Address;
  userDomain?: (addr: Address) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): any {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async readContract(args: any): Promise<unknown> {
      if (args.functionName === "resolve") {
        return handlers.resolve ? handlers.resolve(args.args[0] as string) : ZERO;
      }
      if (args.functionName === "userDomain") {
        return handlers.userDomain ? handlers.userDomain(args.args[0] as Address) : "";
      }
      throw new Error(`unexpected call ${String(args.functionName)}`);
    },
  };
}

/** A stub forward adapter that resolves a single known name. */
function stubAdapter(name: string, addr: Address): QieDomainResolverAdapter {
  return {
    kind: "custom",
    async resolve(n: string): Promise<Address | null> {
      return n.toLowerCase() === name ? addr : null;
    },
  };
}

describe("resolveRecipientDetailed", () => {
  it("resolves a direct 0x address", async () => {
    const r = await resolveRecipientDetailed(ALICE, { client: mockClient({}), contracts, now });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe("address");
      expect(r.source).toBe("direct_address");
      expect(r.verified).toBe(true);
    }
  });

  it("falls back to the Qevie username registry", async () => {
    const client = mockClient({ resolve: (n) => (n === "alice" ? ALICE : ZERO) });
    const r = await resolveRecipientDetailed("alice", { client, contracts, now });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe("qevie_username");
      expect(r.address).toBe(ALICE);
    }
  });

  it("cleanly reports a disabled resolver for .qie when unconfigured", async () => {
    const r = await resolveRecipientDetailed("designer.qie", {
      client: mockClient({}),
      contracts,
      adapter: new DisabledQieResolverAdapter(),
      now,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("resolver_not_configured");
  });

  it("resolves and reverse-verifies a .qie when configured", async () => {
    const client = mockClient({ userDomain: (a) => (a === DESIGNER ? "designer.qie" : "") });
    const r = await resolveRecipientDetailed("designer.qie", {
      client,
      contracts,
      domainConfig: { enabled: true, registry: REGISTRY, resolverType: "custom" },
      adapter: stubAdapter("designer", DESIGNER),
      now,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe("qie_domain");
      expect(r.address).toBe(DESIGNER);
      expect(r.source).toBe("qie_domain_resolver");
      expect(r.verified).toBe(true);
    }
  });

  it("flags a forward result the registry does not confirm as unverified", async () => {
    const client = mockClient({ userDomain: () => "someone-else.qie" });
    const r = await resolveRecipientDetailed("designer.qie", {
      client,
      contracts,
      domainConfig: { enabled: true, registry: REGISTRY, resolverType: "custom" },
      adapter: stubAdapter("designer", DESIGNER),
      now,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.verified).toBe(false);
  });

  it("blocks a .qie the resolver cannot resolve", async () => {
    const r = await resolveRecipientDetailed("ghost.qie", {
      client: mockClient({}),
      contracts,
      domainConfig: { enabled: true, registry: REGISTRY, resolverType: "custom" },
      adapter: new CustomQieResolverAdapter(mockClient({}), REGISTRY, "resolve"),
      now,
    });
    // CustomQieResolverAdapter probes the chain mock which throws → null → blocked.
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("domain_not_found");
  });

  it("reports username-not-found for an unknown bare name", async () => {
    const r = await resolveRecipientDetailed("nobody", { client: mockClient({}), contracts, now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("username_not_found");
  });
});
