export const Decision = {
  ALLOW: 'allow',
  REQUIRE_CONFIRM: 'require_confirm',
  DENY: 'deny',
}

export const SkillAction = {
  LIFI_QUOTE: 'lifi.quote',
  LIFI_EXECUTE: 'lifi.execute',
  LIFI_STATUS: 'lifi.status',
  RISK_CHECK: 'risk.check',
  ADDRESS_SCREEN: 'address.screen',
}

export const LifecycleState = {
  PLANNED: 'planned',
  AWAITING_CONFIRM: 'awaiting_confirm',
  EXECUTING: 'executing',
  POLLING: 'polling',
  COMPLETED: 'completed',
  FAILED: 'failed',
}
