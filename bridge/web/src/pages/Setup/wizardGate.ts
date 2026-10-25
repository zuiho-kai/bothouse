/**
 * The `gate` field of a wizard request. Routing (one primary bot decides who answers) is on by
 * default; only the routing step's checkbox can turn it off. Flows that skip that step (飞书/Lark,
 * a single-role 自建平台, adding a role) send it on, the same as the server's default for a request
 * without the field (core/setup_wizard.go WizardRequest.gateOn).
 */
export function wizardGate(checkboxShown: boolean, checked: boolean): { enabled: boolean } {
  return { enabled: checkboxShown ? checked : true };
}
