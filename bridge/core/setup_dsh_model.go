package core

// Which model a new DSH role talks to, and the key it uses. A DSH role needs both, or every turn fails with
// "llm-deepseek: no API key for provider route ..."; the wizard checks before it writes anything.
//
//   - a third-party API picked in the wizard: a vendor's own Anthropic endpoint (DeepSeek official: only the key),
//     or "custom" = a relay (base_url + key + model). The key goes into the role's env (DSHKeyEnv);
//   - none picked: the user's own DSH setup. Its llm-deepseek / agent-default-model / acp entries (dshHome's
//     profiles/acp/cordis.patch.yml, then cordis.patch.yml) are carried into the role's overlay, and the key its
//     apiKeyEnv names must be somewhere DSH looks (dsh-credentials-local: the credentials file's refs, the
//     launch env, $DSH_HOME/.env) — or a DeepSeek account login.

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// dshDefaultKeyEnv is llm-deepseek's apiKeyEnv default (dsh-llm-deepseek-api-key).
const dshDefaultKeyEnv = "DEEPSEEK_API_KEY"

// dshModelEntryIDs are the entries that set DSH's model: the endpoint and key, the default model, the acp model.
var dshModelEntryIDs = []string{"llm-deepseek", "agent-default-model", "acp"}

// dshProviderBase is the Anthropic endpoint DSH uses for p: the vendor's own, or a custom relay's base_url.
func dshProviderBase(p WizardProvider) (string, error) {
	if p.Vendor == "custom" {
		if b := strings.TrimRight(strings.TrimSpace(p.BaseURL), "/"); b != "" {
			return b, nil
		}
		return "", fmt.Errorf("custom provider for DSH: base_url (the relay's Anthropic endpoint) is required")
	}
	v, _ := wizardVendor(p.Vendor)
	if base := v.Endpoints[ProtocolAnthropic]; base != "" {
		return base, nil
	}
	return "", fmt.Errorf("%s has no Anthropic endpoint, which DSH needs", p.Vendor)
}

// dshHomeLayers are dshHome's own patch layers in DSH's order (a later one wins).
func dshHomeLayers(dshHome string) []string {
	home := DSHHome(dshHome)
	return []string{filepath.Join(home, "profiles", "acp", "cordis.patch.yml"), filepath.Join(home, "cordis.patch.yml")}
}

// dshOwnModelPatch is the user's own model entries from dshHome (dshModelEntryIDs, each the config of the last
// layer that sets it), as overlay text; "" when llm-deepseek is not set there. keyEnv is its apiKeyEnv.
func dshOwnModelPatch(dshHome string) (patch, keyEnv string, err error) {
	var entries []*yaml.Node
	for _, id := range dshModelEntryIDs {
		var cfg *yaml.Node
		for _, l := range dshHomeLayers(dshHome) {
			if c := dshPatchEntryConfig(l, id); c != nil {
				cfg = c
			}
		}
		if cfg == nil {
			if id == "llm-deepseek" {
				return "", "", nil
			}
			continue
		}
		if id == "llm-deepseek" {
			keyEnv = dshDefaultKeyEnv
			if v := mapGet(cfg, "apiKeyEnv"); v != nil && strings.TrimSpace(v.Value) != "" {
				keyEnv = strings.TrimSpace(v.Value)
			}
		}
		e := &yaml.Node{Kind: yaml.MappingNode}
		mapSet(e, "id", &yaml.Node{Kind: yaml.ScalarNode, Value: id})
		mapSet(e, "config", cfg)
		entries = append(entries, e)
	}
	var buf strings.Builder
	buf.WriteString("# written by the bothouse setup wizard: the model setup from your DSH home (" + DSHHome(dshHome) + ").\n")
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(&yaml.Node{Kind: yaml.SequenceNode, Content: entries}); err != nil {
		return "", "", err
	}
	if err := enc.Close(); err != nil {
		return "", "", err
	}
	return buf.String(), keyEnv, nil
}

// dshCredentials reads what matters here from $DSH_HOME/.credentials.yaml: the stored refs (env name → key) and
// whether there is a DeepSeek account login (a deepseek-account* record; client-connection is the web UI's own).
func dshCredentials(dshHome string) (refs map[string]string, account bool) {
	refs = map[string]string{}
	b, err := os.ReadFile(filepath.Join(DSHHome(dshHome), ".credentials.yaml"))
	if err != nil {
		return refs, false
	}
	var doc struct {
		Refs    map[string]any `yaml:"refs"`
		Records map[string]any `yaml:"records"`
	}
	if yaml.Unmarshal(b, &doc) != nil {
		return refs, false
	}
	for k, v := range doc.Refs {
		if s, ok := v.(string); ok && s != "" {
			refs[k] = s
		}
	}
	for k := range doc.Records {
		if strings.HasPrefix(k, "deepseek-account") {
			account = true
		}
	}
	return refs, account
}

// dshDotenvHas: $DSH_HOME/.env sets name (DSH's last fallback for a key).
func dshDotenvHas(dshHome, name string) bool {
	f, err := os.Open(filepath.Join(DSHHome(dshHome), ".env"))
	if err != nil {
		return false
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimPrefix(strings.TrimSpace(sc.Text()), "export ")
		if k, v, ok := strings.Cut(line, "="); ok && strings.TrimSpace(k) == name && strings.Trim(strings.TrimSpace(v), `"'`) != "" {
			return true
		}
	}
	return false
}

// dshModelSetup checks that a new DSH role will have a model and a key, before anything is written. It returns
// the key env for the role (KEY → value; written to its config env and DSHEnvPath): the wizard's api_key for p,
// or — with no p — the user's own key when it is only in this process's env (the service may not have it).
func dshModelSetup(lang, project, dshHome string, p *WizardProvider) (map[string]string, error) {
	if p != nil {
		if _, err := dshProviderBase(*p); err != nil {
			return nil, err
		}
		if strings.TrimSpace(p.APIKey) == "" {
			return nil, fmt.Errorf("%s", dshNoKeyText(lang, project, "provider.api_key"))
		}
		return map[string]string{DSHKeyEnv: strings.TrimSpace(p.APIKey)}, nil
	}
	_, keyEnv, err := dshOwnModelPatch(dshHome)
	if err != nil {
		return nil, err
	}
	if keyEnv == "" {
		keyEnv = dshDefaultKeyEnv
	}
	refs, account := dshCredentials(dshHome)
	if refs[keyEnv] != "" || dshDotenvHas(dshHome, keyEnv) {
		return nil, nil
	}
	if v := os.Getenv(keyEnv); v != "" {
		return map[string]string{keyEnv: v}, nil
	}
	if account {
		return nil, nil
	}
	return nil, fmt.Errorf("%s", dshNoKeyText(lang, project, keyEnv))
}

// dshNoKeyText: a DSH role would have no key for its model (what = the missing field or env name).
func dshNoKeyText(lang, project, what string) string {
	return tr3(lang,
		fmt.Sprintf("DSH 角色 %q 没有可用的模型 key（缺 %s），这样配出来每轮都会报 no API key。请给这个角色填 provider："+
			`官方 DeepSeek 填 {"vendor":"deepseek","api_key":"sk-…"}；中转填 {"vendor":"custom","base_url":"https://<中转>","api_key":"…","model":"<模型名>"}。`+
			"或者先在 DSH 里配好 key（DSH 网页的 Models 页，或 export DEEPSEEK_API_KEY）再运行向导。", project, what),
		fmt.Sprintf("DSH ロール %q に使えるモデルの key がありません（%s がない）。このままでは毎ターン no API key エラーになります。provider を指定してください："+
			`公式 DeepSeek は {"vendor":"deepseek","api_key":"sk-…"}、中継は {"vendor":"custom","base_url":"https://<中継>","api_key":"…","model":"<モデル名>"}。`+
			"または先に DSH で key を設定してから（DSH Web の Models ページ、または export DEEPSEEK_API_KEY）ウィザードを実行してください。", project, what),
		fmt.Sprintf("DSH role %q has no usable model key (%s is missing); every turn would fail with \"no API key\". Give the role a provider: "+
			`DeepSeek official {"vendor":"deepseek","api_key":"sk-…"}; a relay {"vendor":"custom","base_url":"https://<relay>","api_key":"…","model":"<model>"}. `+
			"Or set the key in DSH first (DSH web Models page, or export DEEPSEEK_API_KEY) and run the wizard again.", project, what))
}
