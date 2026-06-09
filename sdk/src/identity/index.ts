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
  verifyDomainOwnership,
  qieDomainExists,
} from "./qieDomains.js";

export {
  DisabledQieResolverAdapter,
  EnsLikeQieResolverAdapter,
  CustomQieResolverAdapter,
  createResolverAdapter,
} from "./resolverAdapter.js";

export { resolveRecipientDetailed } from "./resolveRecipient.js";
export type { ResolveRecipientDeps } from "./resolveRecipient.js";
