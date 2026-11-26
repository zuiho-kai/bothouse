package core

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const handoffTool = "lead/ws-handoff"

// The stable entry point uses the running binary's script and sibling modules.
// Keep the same local rules path as the old installed script.
const managedHandoffLauncher = `#!/usr/bin/env -S python3 -I
# Managed by bothouse.
import os
import runpy
from pathlib import Path

collaboration = Path(__file__).resolve().parents[1]
if not os.environ.get("HANDOFF_RULES_LOCAL"):
    os.environ["HANDOFF_RULES_LOCAL"] = str(collaboration / "handoff-rules.local.json")
runpy.run_path(str(collaboration / "runtime" / "lead" / "ws-handoff"), run_name="__main__")
`

// legacyHandoffSHA256 identifies stock ws-handoff files from older builds.
// Hashes are for LF source bytes. Each ref identifies the source of that copy.
var legacyHandoffSHA256 = map[string]struct{}{
	"9a82097a52c4e7b1a1159911ba961a6378a920c047d8881ff4a25de0369fda72": {}, // v0.1.4–v0.1.11
	"0b48084028c6aadbc66e3042a09745ac097b62f679b53d67e705746c260786f9": {}, // v0.1.12
	"ed5dda44a7daa6cbc2e9bc3f59d308454b9802c50d3fc105cad85d71981ffbaa": {}, // v0.1.13–v0.1.15
	"33a33335c3784b28b7be3db724489fce12e5eb92b011e378b067ba5180ca81ec": {}, // v0.1.16–v0.1.17
	"b527d187a348cc95b7c0ac4607cbdbe7f85f4a988dea08a4b5c3436ec6f6957c": {}, // v0.1.18–v0.1.21
	"63ed9f0e3f717cf3566c12f1e1d5d88be0805f2da2a97c8396ff638732599f75": {}, // v0.1.22
	"dfddd9cd8169b371968ce861083095413c57aa3989cc22160570a2adc48c9878": {}, // v0.1.23
	"657937d35829da1346b8fd7491c9667cd9e7ae29b76c0db8bbbe2a3974222dbf": {}, // v0.1.24
	"f1d1311d72c8d5ab1b1124b3c649dc26ddd2be6a3049736550fcf90c0358ec55": {}, // v0.1.25–v0.1.29
	"8b9b8d23009267b5a3054bbf8b00d0691725654d6bce5e6f7611ac4f66f4cc47": {}, // c05bcef1
	"b1e8082e9886a082bcd06bfb4fbdaaea11109315a7b8c78b3f4696094da733ff": {}, // d9b53a42
	"8736d3345a48ff95573b04b9336b2fc509bf603006fa97b8a964026a88b3b3a2": {}, // 57f2e4fd
	"f1ac21255f42071cf03f7326e3a6ff2fad2b696d1e8e6f6a563972d61654d5e4": {}, // c7e0d77d
	"4b7b0694132477653e9909d242d286236b6304f8e685e96a22d5b4bfb087ccaa": {}, // 6e7e553b
	"c8b84cf61112c15a22254e7ed42e27d68bef2eec424e53a15c6dde6af97c8a4e": {}, // eff7aac8
	"6a6ddaa18a9b9fa151035117937e77c084abd876093457e1a449539257e2fed8": {}, // bda674da
	"685503d81ba09be42826985943b1303c8b7565e988d957d8169b8fee0162fcb0": {}, // 5534595f
	"21260171824f980d79971ecbb5ace6d6023bb54db3090bdbb55bcdaf3ebb3c07": {}, // 3337a5a4
	"7778df3ec5d6dae269c5380b182277b4634a2b0d957e697098a3420a70976d81": {}, // 974b367f
	"dd40f24674279548adf85cba1b04e79f6721e5665458b6c3fa6efd5369808c8c": {}, // 04fd9396
	"175fc8ecfdef041eb10adde603b070a2d203106a368327c4efc7d0e181a3ba60": {}, // d6d5dddd
	"465943d2deb64cb32b00ccf8648891513e5e72504cbad5d08b856919764b2f9c": {}, // dfa4f230
	"8fce5c3aa33ed8d19d1dad5a5800ad3433f0ef62c1c6ab851db265b379256b7f": {}, // e17f6a3f
	"3dab46e91c9d024e92db011d8b6e104f5281b4e391bd56f552b8b14f4b613b00": {}, // 48c68c00
	"7d02e4662db20b8d6514a2e7d18c8398d6b6d15de05992b0577eaf8f1c8f399a": {}, // 375e7b0f
	"ddcf50bc22235d0c34185f336e20372ab44356b91e9fab357434aea1eff01cf4": {}, // 98b3a881
	"5d55e81959f8dbee9959658c854d51bbba952eaaf21174a8a59177cb87d25eed": {}, // ea24ef53
	"70839db458a365022966dc471aa59db20d5391195be0b55aabd7fe0dba94209e": {}, // a87e5be6
	"22679739f9f52f45aa676ce657f3119a744c8a4c139909ad28a677f1e047ac8b": {}, // fea3f706
	"d1c13d2ca9c193f60d08b17c4eedc8b6aae77fca24d95812417ed01a03fbb6e7": {}, // 02bda244
	"c8f08f982d94bc6774e08440df1193c773a68ad4206a0cd50632acc1a332dbfe": {}, // 11147808
	"fdb7aaa18e9f1fec2f971a4233331f7669ef75cb9cd833a3f4551fdc5c6802a0": {}, // e5f5b3ef
	"d808a43ccf715d0293cdeba1ae42f528f1c32b059ff11c4876471b34399a6340": {}, // 7d972095
	"7dadf20904bf7b8b9543933d10f07be0a04fe1c413bca15df169552bb3efa5df": {}, // a2cb4d71
	"e82648d1b6872532f93e8aeebf9513a99ac6ad09fe0e0c2243b1d05aed106bc0": {}, // c3af5748
	"96af9134bf5c248d3a4274f7e5db0300323daccd427dd470b1e46288c0818304": {}, // 375eed8d
	"cdd9d9737dabdc53dbc657537163751674bcc7c909edae8cf6ec6b0065485f15": {}, // 03dfdcd8
	"ee1addb18e5efa7322c498c7ea8f36b63743eee052541711477cb7d6b293e040": {}, // 0486b989
	"e3628480c3ad1a7079f55828651a4169a5a1c60df1c0b17c926b978aa3760af6": {}, // f0334721
	"2a7e5509c63f1b1a5ae7e159a2430d443032edeff642dbe254e6369f0fbbde3e": {}, // a2d009a4
	"875ab659ff88a7b8e282dd5b54c59b3a4c55a49ae1c0b66eb24db0ce957aa119": {}, // ce3d827d
	"9b47ba1fb972995dec4d295c11cd7781db63470864df8c5ff032c71127b70cb9": {}, // c4175a77
	"594cc57b1d53ea3fbfaaf0f52a04d5f0afe6d2c10e140f92ff7506c61104e3e3": {}, // 0a255a9a
	"7f33355a647b30f3820790a5cf124ddcf688462c91ae086696d44b1084020fff": {}, // 17542702
	"bc284f9cf87649431ba5f74d2821f19ee713e7f1660d5fb82411ccfb889d87f0": {}, // f269b018
	"daf974a290e0d3264d9f44814f02131022079811d8543dabca408242a022d21b": {}, // 010c494e
	"ab20206eb87cc8e93647109f36371f247bbb102f55da38cad10bd9458d82ea92": {}, // 4d76c396
	"f0a537b96161d4c7aa4405325c083c237d4a784e22e7675d757af944a8fa2f84": {}, // 5d777373
	"d332acd66d21104e8f1d00a6b29d638511c45db33a0a41692b24ca8dd75c75a1": {}, // 3b6507e1
	"34fcd95bd92a432a207a0324cf76db8c13b5506cf617900e80c9c0cd11bd8406": {}, // 7c095d4e
}

func migrateInstalledHandoff(collaborationDir string, bundled []byte) error {
	path := filepath.Join(collaborationDir, filepath.FromSlash(handoffTool))
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("stat installed ws-handoff: %w", err)
	}
	if !info.Mode().IsRegular() {
		return nil
	}
	old, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read installed ws-handoff: %w", err)
	}
	lf := bytes.ReplaceAll(old, []byte("\r\n"), []byte("\n"))
	launcher := []byte(managedHandoffLauncher)
	if bytes.Equal(lf, launcher) {
		return nil
	}
	_, legacy := legacyHandoffSHA256[fmt.Sprintf("%x", sha256.Sum256(lf))]
	if !legacy && !bytes.Equal(lf, bytes.ReplaceAll(bundled, []byte("\r\n"), []byte("\n"))) {
		return nil
	}
	if err := AtomicWriteFile(path, launcher, info.Mode().Perm()); err != nil {
		return fmt.Errorf("write installed ws-handoff: %w", err)
	}
	return nil
}
