package model

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Platforms render tasks, sub-agents and progress entries; they must take
// those types from this package, not from core. core keeps aliases for its
// own code, so `core.Task` still compiles in a platform — this test is what
// stops it from coming back.
func TestPlatformsTakeBoardTypesFromModel(t *testing.T) {
	fset := token.NewFileSet()
	names := map[string]bool{}
	own, _ := filepath.Glob("*.go")
	for _, f := range own {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		af, err := parser.ParseFile(fset, f, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		for name, obj := range af.Scope.Objects {
			if ast.IsExported(name) && (obj.Kind == ast.Typ || obj.Kind == ast.Con) {
				names[name] = true
			}
		}
	}
	err := filepath.Walk(filepath.Join("..", "..", "platform"), func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") {
			return err
		}
		af, err := parser.ParseFile(fset, path, nil, parser.SkipObjectResolution)
		if err != nil {
			return err
		}
		ast.Inspect(af, func(n ast.Node) bool {
			sel, ok := n.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			if pkg, ok := sel.X.(*ast.Ident); ok && pkg.Name == "core" && names[sel.Sel.Name] {
				t.Errorf("%s: core.%s — use model.%s (bridge/core/model)", fset.Position(sel.Pos()), sel.Sel.Name, sel.Sel.Name)
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
