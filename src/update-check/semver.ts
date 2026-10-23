/**
 * Minimal semver comparison — the v1 comparator, ported.
 *
 * Returns <0 when `a` is older, 0 when equal, >0 when newer. Pre-release
 * tags sort below their release (1.0.0-rc.1 < 1.0.0), matching the update
 * feed's expectations. Anything unparseable sorts as 0 (treated equal, so
 * no update is offered — silence over nagging).
 */

function parse(version: string): {
  major: number
  minor: number
  patch: number
  prerelease: string[]
} | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?/.exec(version.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  }
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
    const leftNum = Number(left)
    const rightNum = Number(right)
    const bothNum = !Number.isNaN(leftNum) && !Number.isNaN(rightNum)
    if (bothNum) {
      if (leftNum !== rightNum) return leftNum - rightNum
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
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  if (left.patch !== right.patch) return left.patch - right.patch
  return comparePrerelease(left.prerelease, right.prerelease)
}
