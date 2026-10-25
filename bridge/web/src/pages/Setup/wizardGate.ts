/**
 * The `gate` field of a wizard request. Routing (one primary bot decides who answers) is on by
 * default; only the routing step's checkbox can change it. Flows that skip that step (飞书/Lark,
 * a single-role 自建平台, adding a role) send no field: the server keeps the user's earlier choice,
 * and with none recorded it is on (core/setup_wizard.go ApplyWizard, SetupState.GateOff).
 */
export function wizardGate(checkboxShown: boolean, checked: boolean): { enabled: boolean } | undefined {
  return checkboxShown ? { enabled: checked } : undefined;
}
