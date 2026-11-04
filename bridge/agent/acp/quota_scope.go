package acp

import "strings"

// QuotaScope separates ACP backends that share the bridge process and HOME.
// Every ACP agent reports Name() "acp", so without this a Cursor billing-cycle
// cooldown was stored under the same key as the DeepSeek ACP role and blocked
// it too (2026-11-04: relay to 肥鱼 refused "cooling down for 624h48m37s",
// which was Cursor's cycle end 11-30). The command plus auth method identifies
// the credential source; roles running the same command still share one key.
func (a *Agent) QuotaScope(string) (string, string) {
	account := "cmd:" + strings.TrimSpace(a.cmd)
	if a.authMethod != "" {
		account += "|auth:" + a.authMethod
	}
	return account, ""
}
