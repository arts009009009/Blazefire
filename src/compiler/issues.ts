/**
 * Issue-marshalling policy (spec H-09).
 *
 * v1 always transferred every compilation issue/diagnostic across the napi
 * boundary and then FORCED them to [] on the JS side before sending to the
 * browser (hot-reloader-turbopack.ts, TODO(PACK-2049)) — hundreds of
 * duplicate messages marshalled just to be discarded.
 *
 * v2 suppresses at the SOURCE: the subscription tells Rust not to emit
 * discarded issues at all, and a defensive strip runs on every payload
 * before any JS consumer sees it, so the waste cannot silently return.
 */

export type IssuePolicy = 'suppress' | 'passthrough'

/** Should the Rust side marshal issues for this subscription at all? */
export function shouldForwardIssues(policy: IssuePolicy): boolean {
  return policy === 'passthrough'
}

export interface IssueBearingPayload {
  issues?: unknown
  diagnostics?: unknown
}

/**
 * Defensive strip: drop issue/diagnostic payloads that no JS consumer will
 * use. Returns the SAME object when the policy forwards issues (zero cost on
 * the passthrough path).
 */
export function stripDiscardedIssues<T extends IssueBearingPayload>(
  payload: T,
  policy: IssuePolicy
): T {
  if (shouldForwardIssues(policy)) return payload
  if (payload.issues !== undefined || payload.diagnostics !== undefined) {
    const { issues: _i, diagnostics: _d, ...rest } = payload
    return rest as T
  }
  return payload
}
