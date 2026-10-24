/**
 * Minimal semver comparison — the v1 comparator, ported.
 *
 * Returns <0 when `a` is older, 0 when equal, >0 when newer. Pre-release
 * tags sort below their release (1.0.0-rc.1 < 1.0.0), matching the update
 * feed's expectations. Anything unparseable sorts as 0 (treated equal, so
 * no update is offered — silence over nagging).
 */

function parse(version: string): {
  major: bigint
  minor: bigint
  patch: bigint
  prerelease: string[]
} | null {
  const identifier = '(?:0|[1-9]\\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)'
  const match = new RegExp(
    `^v?(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${identifier}(?:\\.${identifier})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`
  ).exec(version.trim())
  if (!match) return null
  return {
    major: BigInt(match[1]!),
    minor: BigInt(match[2]!),
    patch: BigInt(match[3]!),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

export function isValidVersion(version: string): boolean {
  return parse(version) !== null
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1 // release > pre-release
  if (b.length === 0) return -1

  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const left = a[i]
    const right = b[i]
    if (left === undefined) return -1
    if (right === undefined) return 1
    const leftNum = /^(0|[1-9]\d*)$/.test(left)
    const rightNum = /^(0|[1-9]\d*)$/.test(right)
    if (leftNum && rightNum) {
      const leftValue = BigInt(left)
      const rightValue = BigInt(right)
      if (leftValue !== rightValue) return leftValue < rightValue ? -1 : 1
    } else if (leftNum !== rightNum) {
      return leftNum ? -1 : 1
    } else if (left !== right) {
      return left < right ? -1 : 1
    }
  }
  return 0
}

export function compareVersions(a: string, b: string): number {
  const left = parse(a)
  const right = parse(b)
  if (!left || !right) return 0
  if (left.major !== right.major) return left.major < right.major ? -1 : 1
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1
  return comparePrerelease(left.prerelease, right.prerelease)
}
