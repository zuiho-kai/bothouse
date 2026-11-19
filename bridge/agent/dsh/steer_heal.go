package dsh

// Steer self-heal (#1570). The bridge folds a message sent while a turn runs into that turn only
// when dsh-acp advertises "dsh/steer" (agent/acp/session_steer.go). Stock DSH does not; the patch
// lives in dsh/runtime-patches/dsh-acp-steer.patch and dsh/install.sh applies it, but any npm
// reinstall or upgrade of DSH drops it and nothing said so: 10-28 (new install path) and again
// 11-12 (agentm moved to hw190, DSH reinstalled), each time the busy bot only answered
// 「将在当前任务完成后处理」. Now every DSH session start checks the installed dsh-acp and puts the
// same three edits back when they are missing; when it cannot (unknown version, read-only
// install) it logs a warning that says busy messages will queue.

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/chenhg5/cc-connect/core"
)

const steerHealMarker = `"dsh/steer"`

// The steer's admission call. The model route is read the way the installed dsh-acp reads it for
// an ordinary prompt: 0.2.1 has modelControl.snapshot(), 0.2.2 dropped it for agent.model.current().
// steerAdmitOld is what the patch wrote until #882; on 0.2.2 it threw "this.modelControl.snapshot is
// not a function", the steer was refused and every busy message queued behind the running turn.
const (
	steerAdmitOld = "admitAcpPrompt(this.ctx, this.modelControl.snapshot(), params.prompt, imageEnabled, controller.signal)"
	steerAdmit    = "admitAcpPrompt(this.ctx, this.modelControl.snapshot?.() ?? this.agent.model.current(), params.prompt, imageEnabled, controller.signal)"
)

// steerEdit is one hunk of dsh-acp-steer.patch: anchor (found exactly once) is replaced by text,
// or, with before, text goes in front of it.
type steerEdit struct {
	anchor string
	text   string
	before bool
}

var steerEdits = []steerEdit{
	{
		anchor: "\t\tthis.assertActive();\n\t\tif (this.inflight !== void 0) throw invalidParams$1(\"a prompt is already in flight for this session\");",
		text: "\t\tthis.assertActive();\n" +
			"\t\t// [bothouse patch] Only a request that asks to steer (_meta \"dsh/steer\") joins a running prompt;\n" +
			"\t\t// any other busy prompt keeps the stock rejection.\n" +
			"\t\tif (params._meta?.[\"dsh/steer\"] === true) return this.steerPrompt(params, imageEnabled, requestSignal);\n" +
			"\t\tif (this.inflight !== void 0) throw invalidParams$1(\"a prompt is already in flight for this session\");",
	},
	{
		anchor: "\t/** Cancel the active prompt, or autonomous work when no ACP prompt exists. */\n\tcancel() {",
		text: "\t/**\n" +
			"\t* [bothouse patch] Busy-session prompt: hand the message to the running turn as\n" +
			"\t* agent.steer (consumed at the next model step, after the current tool call),\n" +
			"\t* and answer at once. Output keeps flowing through the in-flight prompt, which\n" +
			"\t* settles only after the steered work goes idle.\n" +
			"\t*/\n" +
			"\tasync steerPrompt(params, imageEnabled, requestSignal) {\n" +
			"\t\t// Steerable: a prompt whose own message is already queued and which is not being cancelled.\n" +
			"\t\t// Anything else is refused so the client queues the message; a steer never starts a turn.\n" +
			"\t\tconst steerable = () => {\n" +
			"\t\t\tconst inflight = this.inflight;\n" +
			"\t\t\treturn inflight !== void 0 && inflight.messageQueued && !inflight.admissionController.signal.aborted;\n" +
			"\t\t};\n" +
			"\t\tif (!steerable()) throw invalidParams$1(\"no running prompt to steer\");\n" +
			"\t\tconst controller = new AbortController();\n" +
			"\t\tconst onAbort = () => controller.abort(new Error(\"ACP steer request cancelled\"));\n" +
			"\t\trequestSignal?.addEventListener(\"abort\", onAbort, { once: true });\n" +
			"\t\ttry {\n" +
			"\t\t\tconst content = await " + steerAdmit + ";\n" +
			"\t\t\tcontroller.signal.throwIfAborted();\n" +
			"\t\t\tif (!steerable()) throw invalidParams$1(\"no running prompt to steer\");\n" +
			"\t\t\tthis.agent.steer(createUserMessage({\n" +
			"\t\t\t\tcontent,\n" +
			"\t\t\t\tsource: { kind: \"user\" }\n" +
			"\t\t\t}));\n" +
			"\t\t\treturn {\n" +
			"\t\t\t\tstopReason: \"end_turn\",\n" +
			"\t\t\t\t_meta: { \"dsh/steered\": true }\n" +
			"\t\t\t};\n" +
			"\t\t} catch (error) {\n" +
			"\t\t\tif (error instanceof AcpContentError) throw error.kind === \"invalid\" ? invalidParams$1(error.message) : internalError$1(error.message);\n" +
			"\t\t\tif (error instanceof RequestError) throw error;\n" +
			"\t\t\tthrow internalError$1(`steer was not queued: ${error.message}`);\n" +
			"\t\t} finally {\n" +
			"\t\t\trequestSignal?.removeEventListener(\"abort\", onAbort);\n" +
			"\t\t}\n" +
			"\t}\n",
		before: true,
	},
	{
		anchor: "\t\t\t\t\t\tresume: {}\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\tauthMethods: []",
		text:   "\t\t\t\t\t\tresume: {}\n\t\t\t\t\t},\n\t\t\t\t\t_meta: { \"dsh/steer\": true }\n\t\t\t\t},\n\t\t\t\tauthMethods: []",
	},
}

// applySteerEdits returns src with the steer edits, or ok=false when any anchor is not found
// exactly once (a DSH version the patch was not written for).
func applySteerEdits(src string) (string, bool) {
	for _, ed := range steerEdits {
		if strings.Count(src, ed.anchor) != 1 {
			return src, false
		}
		repl := ed.text
		if ed.before {
			repl = ed.text + ed.anchor
		}
		src = strings.Replace(src, ed.anchor, repl, 1)
	}
	return src, true
}

// steerHealed remembers files already checked in this process, keyed by path and mtime.
var steerHealed sync.Map

// healSteer checks the dsh-acp the configured command runs and patches it when needed.
func healSteer(cmd string, args []string) {
	entry := dshEntryScript(cmd, args)
	files := dshACPFiles(cmd, args)
	for _, js := range files {
		fi, err := os.Stat(js)
		if err != nil {
			continue
		}
		key := js + "|" + fi.ModTime().String()
		if _, done := steerHealed.Load(key); done {
			return
		}
		steerHealed.Store(key, true)
		b, err := os.ReadFile(js)
		if err != nil {
			slog.Warn("dsh: cannot read dsh-acp; busy messages will queue instead of joining the turn", "file", js, "err", err)
			return
		}
		if strings.Contains(string(b), steerHealMarker) {
			// Patched by an earlier bridge: its admission call only fits dsh-acp 0.2.1 (#882).
			if strings.Contains(string(b), steerAdmitOld) {
				out := strings.ReplaceAll(string(b), steerAdmitOld, steerAdmit)
				if err := writeHealed(js, b, out, fi.Mode()); err != nil {
					slog.Warn("dsh: the steer patch in dsh-acp does not fit this DSH version and the bridge cannot rewrite it; busy messages will queue", "file", js, "err", err)
					return
				}
				steerHealed.Store(js+"|"+statTime(js), true)
				slog.Warn("dsh: updated the steer patch in dsh-acp so it reads the model route on this DSH version", "file", js)
			}
			return
		}
		out, ok := applySteerEdits(string(b))
		if !ok {
			slog.Warn("dsh: dsh-acp has no mid-turn input and the steer patch does not fit this DSH version; busy messages will queue", "file", js)
			return
		}
		if err := writeHealed(js, b, out, fi.Mode()); err != nil {
			slog.Warn("dsh: dsh-acp lost the steer patch (DSH reinstalled or upgraded) and the bridge cannot write it back; busy messages will queue. Rerun dsh/install.sh as the owner of the DSH install", "file", js, "err", err)
			return
		}
		steerHealed.Store(js+"|"+statTime(js), true)
		slog.Warn("dsh: dsh-acp had lost the steer patch (DSH reinstalled or upgraded); patched it back so busy messages join the running turn", "file", js, "backup", js+".bak-presteer")
		return
	}
	slog.Warn("dsh: cannot locate dsh-acp for steer patch; busy messages will queue unless the loaded ACP already advertises dsh/steer", "command", cmd, "entry", entry, "candidates", files)
}

func prepareSteer(cmd string, args []string, home string) []string {
	entry := dshEntryScript(cmd, args)
	i := strings.Index(strings.ToLower(filepath.ToSlash(entry)), ".asar/")
	if i < 0 {
		healSteer(cmd, args)
		return args
	}
	archive := entry[:i+len(".asar")]
	const bundledACP = "dsh/node_modules/@deepseek-ai/dsh-acp/lib/index.js"
	profile := dshProfile(args)
	packageDir := filepath.Join(home, "profiles", profile, "node_modules", "@deepseek-ai", "dsh-acp")
	copyPath := filepath.Join(packageDir, "lib", "index.js")
	stampPath := filepath.Join(packageDir, ".bothouse-asar-source")
	archiveInfo, archiveErr := os.Stat(archive)
	sourceStamp := ""
	if archiveErr == nil {
		sourceStamp = fmt.Sprintf("%s|%d|%d", archive, archiveInfo.Size(), archiveInfo.ModTime().UnixNano())
	}
	stamp, _ := os.ReadFile(stampPath)
	if sourceStamp != "" && string(stamp) == sourceStamp {
		copyBytes, copyErr := os.ReadFile(copyPath)
		_, manifestErr := os.Stat(filepath.Join(packageDir, "package.json"))
		if copyErr == nil && manifestErr == nil && strings.Contains(string(copyBytes), steerHealMarker) {
			slog.Info("dsh: loading patched desktop ACP profile package", "archive", archive, "loaded", copyPath)
			return args
		}
	}
	original, err := readASARFile(archive, bundledACP)
	if err != nil {
		slog.Warn("dsh: cannot extract desktop dsh-acp from ASAR; busy messages will queue", "archive", archive, "member", bundledACP, "err", err)
		return args
	}
	manifest, err := readASARFile(archive, "dsh/node_modules/@deepseek-ai/dsh-acp/package.json")
	if err != nil {
		slog.Warn("dsh: cannot extract desktop dsh-acp manifest from ASAR; busy messages will queue", "archive", archive, "err", err)
		return args
	}
	patched, ok := applySteerEdits(string(original))
	if !ok {
		slog.Warn("dsh: desktop dsh-acp version does not match the steer patch; busy messages will queue", "archive", archive, "member", bundledACP)
		return args
	}
	var packageManifest map[string]any
	if err := json.Unmarshal(manifest, &packageManifest); err != nil {
		slog.Warn("dsh: cannot parse desktop dsh-acp manifest; busy messages will queue", "archive", archive, "err", err)
		return args
	}
	version, _ := packageManifest["version"].(string)
	if version == "" {
		slog.Warn("dsh: desktop dsh-acp manifest has no version; busy messages will queue", "archive", archive)
		return args
	}
	if err := os.MkdirAll(filepath.Dir(copyPath), 0o755); err != nil {
		slog.Warn("dsh: cannot create desktop steer copy; busy messages will queue", "path", copyPath, "err", err)
		return args
	}
	if err := os.WriteFile(copyPath, []byte(patched), 0o600); err != nil {
		slog.Warn("dsh: cannot write desktop steer copy; busy messages will queue", "path", copyPath, "err", err)
		return args
	}
	if err := os.WriteFile(filepath.Join(packageDir, "package.json"), manifest, 0o600); err != nil {
		slog.Warn("dsh: cannot write desktop ACP package manifest", "path", packageDir, "err", err)
		return args
	}
	profileManifestPath := filepath.Join(home, "profiles", profile, "package.json")
	profileManifestBytes, err := os.ReadFile(profileManifestPath)
	if err != nil {
		slog.Warn("dsh: cannot read desktop ACP profile manifest; busy messages will queue", "path", profileManifestPath, "err", err)
		return args
	}
	var profileManifest map[string]any
	if err := json.Unmarshal(profileManifestBytes, &profileManifest); err != nil {
		slog.Warn("dsh: cannot parse desktop ACP profile manifest; busy messages will queue", "path", profileManifestPath, "err", err)
		return args
	}
	dependencies, _ := profileManifest["dependencies"].(map[string]any)
	if dependencies == nil {
		dependencies = make(map[string]any)
		profileManifest["dependencies"] = dependencies
	}
	dependencies["@deepseek-ai/dsh-acp"] = version
	updatedManifest, err := json.Marshal(profileManifest)
	if err != nil {
		slog.Warn("dsh: cannot encode desktop ACP profile manifest", "path", profileManifestPath, "err", err)
		return args
	}
	if err := os.WriteFile(profileManifestPath, updatedManifest, 0o600); err != nil {
		slog.Warn("dsh: cannot register desktop ACP profile package", "path", profileManifestPath, "err", err)
		return args
	}
	if err := os.WriteFile(stampPath, []byte(sourceStamp), 0o600); err != nil {
		slog.Warn("dsh: cannot record desktop ACP archive version; next start will rebuild the copy", "path", stampPath, "err", err)
	}
	slog.Info("dsh: extracted and patched desktop ACP; loading profile package", "archive", archive, "member", bundledACP, "loaded", copyPath, "version", version)
	return args
}

func dshProfile(args []string) string {
	for i := range args {
		if args[i] == "--profile" && i+1 < len(args) {
			return args[i+1]
		}
		if strings.HasPrefix(args[i], "--profile=") {
			return strings.TrimPrefix(args[i], "--profile=")
		}
	}
	return "acp"
}

func readASARFile(archive, member string) ([]byte, error) {
	f, err := os.Open(archive)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if info.Size() < 16 {
		return nil, fmt.Errorf("ASAR header is truncated")
	}
	sizeBuf := make([]byte, 16)
	if _, err := io.ReadFull(f, sizeBuf); err != nil {
		return nil, err
	}
	headerSize := int(binary.LittleEndian.Uint32(sizeBuf[4:8]))
	jsonSize := int(binary.LittleEndian.Uint32(sizeBuf[12:16]))
	if headerSize < 8 || int64(headerSize) > info.Size()-8 || jsonSize < 0 || jsonSize > headerSize-8 {
		return nil, fmt.Errorf("invalid ASAR header sizes")
	}
	headerData := make([]byte, headerSize-8)
	if _, err := io.ReadFull(f, headerData); err != nil {
		return nil, err
	}
	var header struct {
		Files map[string]asarEntry `json:"files"`
	}
	if err := json.Unmarshal(headerData[:jsonSize], &header); err != nil {
		return nil, err
	}
	entry, ok := findASAREntry(header.Files, strings.Split(filepath.ToSlash(member), "/"))
	if !ok || entry.Files != nil || entry.Unpacked {
		return nil, fmt.Errorf("member %q is missing or unpacked", member)
	}
	offset, err := strconv.ParseInt(entry.Offset, 10, 64)
	dataStart := 8 + headerSize
	if err != nil || offset < 0 || entry.Size < 0 || int64(dataStart)+offset+int64(entry.Size) > info.Size() {
		return nil, fmt.Errorf("member %q has invalid bounds", member)
	}
	if _, err := f.Seek(int64(dataStart)+offset, io.SeekStart); err != nil {
		return nil, err
	}
	content := make([]byte, entry.Size)
	if _, err := io.ReadFull(f, content); err != nil {
		return nil, err
	}
	return content, nil
}

type asarEntry struct {
	Files    map[string]asarEntry `json:"files"`
	Offset   string               `json:"offset"`
	Size     int                  `json:"size"`
	Unpacked bool                 `json:"unpacked"`
}

func findASAREntry(files map[string]asarEntry, parts []string) (asarEntry, bool) {
	entry, ok := files[parts[0]]
	if !ok || len(parts) == 1 {
		return entry, ok
	}
	return findASAREntry(entry.Files, parts[1:])
}

func statTime(p string) string {
	if fi, err := os.Stat(p); err == nil {
		return fi.ModTime().String()
	}
	return ""
}

func writeHealed(js string, orig []byte, out string, mode os.FileMode) error {
	bak := js + ".bak-presteer"
	if _, err := os.Stat(bak); os.IsNotExist(err) {
		if err := os.WriteFile(bak, orig, mode.Perm()); err != nil {
			return err
		}
	}
	tmp := js + ".steer-tmp"
	if err := os.WriteFile(tmp, []byte(out), mode.Perm()); err != nil {
		return err
	}
	if err := os.Rename(tmp, js); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// dshACPFiles lists where the dsh-acp of the configured DSH may be: nested in the DSH package or
// hoisted next to it.
func dshACPFiles(cmd string, args []string) []string {
	pkg := dshPackageDir(cmd, args)
	if pkg == "" {
		return nil
	}
	return []string{
		filepath.Join(pkg, "node_modules", "@deepseek-ai", "dsh-acp", "lib", "index.js"),
		filepath.Join(filepath.Dir(pkg), "dsh-acp", "lib", "index.js"),
	}
}

// dshPackageDir finds the @deepseek-ai/dsh package directory from the command ("dsh" on PATH, a
// symlink to lib/bin.js) or, when the command is node, from its first .js argument.
func dshPackageDir(cmd string, args []string) string {
	start := dshEntryScript(cmd, args)
	if start == "" {
		return ""
	}
	dir := filepath.Dir(start)
	for i := 0; i < 4 && dir != filepath.Dir(dir); i++ {
		if b, err := os.ReadFile(filepath.Join(dir, "package.json")); err == nil && strings.Contains(string(b), `"name": "@deepseek-ai/dsh"`) {
			return dir
		}
		dir = filepath.Dir(dir)
	}
	return ""
}

func dshEntryScript(cmd string, args []string) string {
	var start string
	base := strings.ToLower(filepath.Base(cmd))
	if base == "node" || base == "node.exe" || strings.HasSuffix(base, ".exe") {
		for _, a := range args {
			if strings.HasSuffix(a, ".js") || strings.HasSuffix(a, ".mjs") {
				start = a
				break
			}
		}
	}
	if start == "" && cmd != "" {
		if p, err := exec.LookPath(cmd); err == nil {
			start = p
		}
	}
	if start == "" {
		return ""
	}
	if r, err := filepath.EvalSymlinks(start); err == nil {
		start = r
	}
	if ext := strings.ToLower(filepath.Ext(start)); ext == ".cmd" || ext == ".bat" {
		if script := dshShimScript(start); script != "" {
			start = script
		}
	}
	return start
}

func dshShimScript(shim string) string {
	b, err := os.ReadFile(shim)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(b), "\n") {
		for rest := line; ; {
			start := strings.IndexByte(rest, '"')
			if start < 0 {
				break
			}
			rest = rest[start+1:]
			end := strings.IndexByte(rest, '"')
			if end < 0 {
				break
			}
			arg, tail := rest[:end], rest[end+1:]
			rest = tail
			lower := strings.ToLower(strings.ReplaceAll(arg, "\\", "/"))
			if (!strings.Contains(lower, "@deepseek-ai/dsh/") && !strings.Contains(lower, ".asar/")) || !strings.HasSuffix(lower, ".js") {
				continue
			}
			if strings.HasPrefix(strings.ToLower(arg), "%dp0%") || strings.HasPrefix(strings.ToLower(arg), "%~dp0") {
				rel := strings.ReplaceAll(arg[5:], "\\", string(os.PathSeparator))
				return filepath.Clean(filepath.Join(filepath.Dir(shim), strings.TrimLeft(rel, `/\\`)))
			}
			arg = strings.ReplaceAll(arg, "\\", string(os.PathSeparator))
			if !filepath.IsAbs(arg) {
				arg = filepath.Join(filepath.Dir(shim), arg)
			}
			return filepath.Clean(arg)
		}
	}
	return ""
}

// StartSession checks the steer patch before each DSH session (cheap: one stat when unchanged).
func (a *Agent) StartSession(ctx context.Context, sessionID string) (core.AgentSession, error) {
	a.args = prepareSteer(a.cmd, a.args, a.home)
	return a.Agent.StartSession(ctx, sessionID)
}
