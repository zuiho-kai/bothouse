package core

import (
	"bytes"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Engine grew to a 20k-line engine.go with ~1200 methods because every new
// feature was the easiest thing to hang on it. These numbers are a ratchet:
// they may only go down. A change that lowers one lowers the constant in the
// same PR; a change that would raise one belongs somewhere else (the failure
// message says where).
const (
	maxEngineGoLines  = 3000 // engine.go is a 2234-line core; topics live in engine_<topic>.go
	wantEngineFields  = 198
	wantEngineMethods = 1168
	wantEngineSetters = 98
)

func TestEngineShapeRatchet(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	var fields, methods, setters int
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		af, err := parser.ParseFile(fset, f, nil, parser.SkipObjectResolution)
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range af.Decls {
			switch x := d.(type) {
			case *ast.GenDecl:
				for _, s := range x.Specs {
					ts, ok := s.(*ast.TypeSpec)
					if !ok || ts.Name.Name != "Engine" {
						continue
					}
					if st, ok := ts.Type.(*ast.StructType); ok {
						for _, fl := range st.Fields.List {
							fields += max(len(fl.Names), 1)
						}
					}
				}
			case *ast.FuncDecl:
				if engineRecv(x) != "Engine" {
					continue
				}
				methods++
				if strings.HasPrefix(x.Name.Name, "Set") {
					setters++
				}
			}
		}
	}
	src, err := os.ReadFile("engine.go")
	if err != nil {
		t.Fatal(err)
	}
	if n := bytes.Count(src, []byte("\n")); n > maxEngineGoLines {
		t.Errorf("engine.go has %d lines, the limit is %d. Put new code in engine_<topic>.go or, better, in its own type or package; engine.go keeps only the Engine struct, NewEngine, Start/Stop and the message entry.", n, maxEngineGoLines)
	}
	engineRatchet(t, "Engine fields", fields, wantEngineFields, "Keep a new feature's state in its own type; Engine holds at most one pointer to it (like e.publicProgress).")
	engineRatchet(t, "Engine methods", methods, wantEngineMethods, "Write a new feature as methods of its own type or as package functions, and pass in what it needs.")
	engineRatchet(t, "Engine Set* methods", setters, wantEngineSetters, "Startup-only wiring goes into EngineOptions (engine_options.go); only settings that change at run time get a setter.")
}

func engineRatchet(t *testing.T, what string, got, want int, where string) {
	t.Helper()
	switch {
	case got > want:
		t.Errorf("%s: %d, the ceiling is %d (%d more). %s", what, got, want, got-want, where)
	case got < want:
		t.Errorf("%s: %d, below the ceiling %d. Lower the constant in engine_shape_test.go to %d so it cannot grow back.", what, got, want, got)
	}
}

func engineRecv(fd *ast.FuncDecl) string {
	if fd.Recv == nil || len(fd.Recv.List) == 0 {
		return ""
	}
	t := fd.Recv.List[0].Type
	if s, ok := t.(*ast.StarExpr); ok {
		t = s.X
	}
	if id, ok := t.(*ast.Ident); ok {
		return id.Name
	}
	return ""
}
