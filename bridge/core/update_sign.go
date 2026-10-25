package core

import (
	"errors"
	"fmt"
	"log/slog"
	"os/exec"
	"runtime"
	"strings"
)

// The release signing identity, set only by the release build (.github/workflows/release.yml):
//
//	-X github.com/chenhg5/cc-connect/core.ReleaseSignerID=ai.bothouse.desktop   (every platform)
//	-X github.com/chenhg5/cc-connect/core.ReleaseSignerHash=<cert leaf SHA-1>    (darwin)
//
// A build without them is a local build: it does not update itself, because the release binary
// it would download carries a different signature and macOS would drop its privacy (TCC)
// permissions (#299). On macOS a release build also checks that the running binary still carries
// the release signature, so a release re-signed with someone else's certificate is refused too.
var (
	ReleaseSignerID   string
	ReleaseSignerHash string
)

// ErrSelfBuiltUpdate is returned by every update entry when this binary must not update itself.
var ErrSelfBuiltUpdate = errors.New("本机自编译版不支持自我升级，请用自己的构建流程升级 / self-built binary: in-app update is disabled, update it with your own build")

// Swappable in tests.
var (
	updateSignGOOS           = runtime.GOOS
	verifyReleaseSignatureFn = verifyReleaseSignature
)

// UpdateRefusal reports why this binary must not replace itself with a release (nil: it may).
func UpdateRefusal() error {
	if ReleaseSignerID == "" {
		return ErrSelfBuiltUpdate
	}
	if updateSignGOOS != "darwin" {
		return nil
	}
	exe := updateExePath()
	if err := verifyReleaseSignatureFn(exe, ReleaseSignerID, ReleaseSignerHash); err != nil {
		slog.Warn("update: running binary does not carry the release signature", "exe", exe, "error", err)
		return ErrSelfBuiltUpdate
	}
	return nil
}

// releaseRequirement is the code requirement the running binary must satisfy. Swappable in
// tests, which cannot sign with the release certificate.
var releaseRequirement = func(id, hash string) string {
	return fmt.Sprintf(`identifier "%s" and certificate leaf = H"%s"`, id, hash)
}

// verifyReleaseSignature asks codesign whether exe is validly signed with identifier id by the
// certificate whose leaf SHA-1 is hash. It verifies the signature rather than reading the
// designated requirement text, which the signer writes and can forge. --ignore-resources skips
// only the resource seal, so the binary inside the (unsealed) .app passes while a forged
// requirement or a modified byte is still refused. Any failure (no hash, codesign missing) counts as no.
func verifyReleaseSignature(exe, id, hash string) error {
	if hash == "" {
		return errors.New("release certificate hash not set")
	}
	out, err := exec.Command("/usr/bin/codesign", "--verify", "--ignore-resources",
		"-R="+releaseRequirement(id, hash), exe).CombinedOutput()
	if err != nil {
		return fmt.Errorf("codesign: %v: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}
