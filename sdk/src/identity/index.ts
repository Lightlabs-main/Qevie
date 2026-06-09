export type {
  QieDomainConfig,
  QieDomainResolverAdapter,
  RecipientKind,
  RecipientSource,
  ResolvedRecipient,
  ResolveFailure,
  ResolveFailureReason,
  ResolveRecipientResult,
} from "./types.js";

export {
  isQieDomain,
  normalizeName,
  stripQieSuffix,
  reverseLookupQieDomain,
  resolveOwnerViaDomainInfo,
  verifyDomainOwnership,
  qieDomainExists,
} from "./qieDomains.js";

export {
  DisabledQieResolverAdapter,
  QieDomainsRegistryAdapter,
  EnsLikeQieResolverAdapter,
  CustomQieResolverAdapter,
  createResolverAdapter,
} from "./resolverAdapter.js";

export { resolveRecipientDetailed } from "./resolveRecipient.js";
export type { ResolveRecipientDeps } from "./resolveRecipient.js";
