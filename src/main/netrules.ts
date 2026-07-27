import type { NetRule } from '@shared/schemas'
import { looseMatch } from '@shared/glob'

/** Padrão com `*` casa a URL inteira; sem `*` é substring. */
export function ruleMatches(rule: NetRule, url: string): boolean {
  return rule.enabled && looseMatch(rule.pattern, url)
}
