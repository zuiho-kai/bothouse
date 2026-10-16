package max

import (
	"os"
	"testing"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

func TestMain(m *testing.M) {
	os.Exit(testutil.RunLocalHTTPTests(m))
}
