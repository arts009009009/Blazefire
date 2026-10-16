import {
  extractInterceptionRouteInformation,
  isInterceptionRouteAppPath,
} from './interception-routes'

// Identify /.*[param].*/ in route string
// The inner group only treats a `]` as part of the parameter when the
// fixed-width lookahead shows it is not the closing bracket, so the repeated
// group and the literal "]" can never both consume the same character —
// matching stays linear while behaving identically to the previous `[^/]+`
// form, including optional catch-alls like /[[...slug]] and segments like
// /[a]].
const TEST_ROUTE = /\/[^/[]*\[(?:[^\]/]|\](?!\/|$))+\][^/]*(?=\/|$)/

// Identify /[param]/ in route string (same linear inner group as above)
const TEST_STRICT_ROUTE = /\/\[(?:[^\]/]|\](?!\/|$))+\](?=\/|$)/

/**
 * Check if a route is dynamic.
 *
 * @param route - The route to check.
 * @param strict - Whether to use strict mode which prohibits segments with prefixes/suffixes (default: true).
 * @returns Whether the route is dynamic.
 */
export function isDynamicRoute(route: string, strict: boolean = true): boolean {
  if (isInterceptionRouteAppPath(route)) {
    route = extractInterceptionRouteInformation(route).interceptedRoute
  }

  if (strict) {
    return TEST_STRICT_ROUTE.test(route)
  }

  return TEST_ROUTE.test(route)
}
