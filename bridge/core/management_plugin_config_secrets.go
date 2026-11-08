package core

import (
	"fmt"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

const pluginConfigSecretTag = "!bothouse/secret"

func pluginConfigSecretKey(key string) bool {
	// 来源：沿用 RedactEnv 的敏感字段分类，补上 HTTP 认证与 Cookie 字段。
	for _, part := range []string{"KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL", "AUTHORIZATION", "COOKIE"} {
		if strings.Contains(strings.ToUpper(key), part) {
			return true
		}
	}
	return false
}

func pluginConfigFieldPath(path, key string) string {
	// JSON Pointer escaping keeps keys containing '/' or '~' distinct from nested fields.
	return path + "/" + strings.ReplaceAll(strings.ReplaceAll(key, "~", "~0"), "/", "~1")
}

// Redact before serialization, including nested maps/sequences. Keep anchors and aliases opaque
// too: otherwise a harmlessly named alias target could expose a secret from another field.
// The tag distinguishes an unchanged value from empty/null, a new value or a removed field.
func pluginConfigForEditor(n *yaml.Node, path string, sensitive bool, retained map[string]*yaml.Node) *yaml.Node {
	empty := n.Kind == yaml.ScalarNode && (n.Tag == "!!null" || n.Value == "")
	if (sensitive && !empty) || n.Anchor != "" || n.Kind == yaml.AliasNode {
		retained[path] = n
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: pluginConfigSecretTag, Value: path}
	}
	out := *n
	out.Content = make([]*yaml.Node, len(n.Content))
	for i, child := range n.Content {
		if n.Kind == yaml.MappingNode {
			if i%2 == 0 {
				out.Content[i] = child
				continue
			}
			key := n.Content[i-1].Value
			out.Content[i] = pluginConfigForEditor(child, pluginConfigFieldPath(path, key), pluginConfigSecretKey(key), retained)
		} else {
			out.Content[i] = pluginConfigForEditor(child, path+"/"+strconv.Itoa(i), false, retained)
		}
	}
	return &out
}

// Match both the location and the placeholder's path. A copied/moved marker cannot disclose a
// credential in a non-secret field, or silently exchange credentials when a list is reordered.
// Read originals afresh under the lock, so unchanged markers preserve the latest stored value.
func restorePluginConfigSecrets(n *yaml.Node, path string, retained map[string]*yaml.Node) error {
	if n.Tag == pluginConfigSecretTag {
		original, ok := retained[path]
		if !ok || n.Kind != yaml.ScalarNode || n.Value != path {
			return fmt.Errorf("已设置占位与原字段不匹配，请刷新后重试；替换密钥请填写新值")
		}
		*n = *original
		return nil
	}
	for i, child := range n.Content {
		childPath := path + "/" + strconv.Itoa(i)
		if n.Kind == yaml.MappingNode {
			if i%2 == 0 {
				if child.Tag == pluginConfigSecretTag {
					return fmt.Errorf("已设置占位只能作为原字段的值")
				}
				continue
			}
			childPath = pluginConfigFieldPath(path, n.Content[i-1].Value)
		}
		if err := restorePluginConfigSecrets(child, childPath, retained); err != nil {
			return err
		}
	}
	return nil
}
