package main

import (
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

const webUsage = `Usage: bothouse web [--no-browser]

Open the web admin of this bothouse in the browser. With no bots configured yet it starts the setup
wizard; when the web admin is off it switches it on in config.toml first.

Flags:
  -n, --no-browser   Print the URL and token instead of opening the browser
  -h, --help         Show this help
`

func runWeb(args []string) {
	// Arguments first: without config this starts the setup wizard, and with the web admin off it
	// writes config.toml.
	noBrowser := false
	for _, a := range args {
		switch {
		case isHelpArg(a):
			fmt.Print(webUsage)
			return
		case a == "--no-browser" || a == "-n":
			noBrowser = true
		default:
			fmt.Fprintf(os.Stderr, "bothouse web: unknown argument %q\n\n%s", a, webUsage)
			os.Exit(2)
		}
	}
	configPath := resolveConfigPath("")
	// conest: no bots configured yet → the setup wizard, same as a first `cc-connect`.
	if needsSetup(configPath) {
		lock, err := AcquireInstanceLock(configPath)
		if err != nil { // already serving (most likely the wizard itself): open its link
			link, rerr := os.ReadFile(setupLinkFile(configPath))
			if rerr != nil {
				fmt.Fprintf(os.Stderr, "%v\n", err)
				os.Exit(1)
			}
			announceSetupWizard(strings.TrimSpace(string(link)), setupLinkFile(configPath), setupPortFromLink(string(link)), !overSSH())
			return
		}
		startSetupWizard(configPath, lock.Release)
		return
	}

	// Use LoadPermissive so `cc-connect web` works even before any platforms
	// are configured (e.g. during initial setup via the Web Admin UI).
	cfg, err := config.LoadPermissive(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading config: %v\n", err)
		os.Exit(1)
	}
	config.ConfigPath = configPath

	mgmtEnabled := cfg.Management.Enabled != nil && *cfg.Management.Enabled
	port := cfg.Management.Port
	if port == 0 {
		port = 9820
	}
	token := cfg.Management.Token

	if !mgmtEnabled {
		fmt.Println("Web admin is not enabled. Configuring...")

		mgmtToken := core.GenerateToken(16)
		bridgeToken := core.GenerateToken(16)
		result, err := config.EnableWebAdmin(mgmtToken, bridgeToken)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error enabling web admin: %v\n", err)
			os.Exit(1)
		}
		port = result.ManagementPort
		token = result.ManagementToken
		fmt.Printf("Web admin configured on port %d.\n", port)
		fmt.Println("Restart bothouse for the changes to take effect.")
	}

	baseURL := fmt.Sprintf("http://localhost:%d", port)

	if noBrowser {
		fmt.Printf("URL:   %s\n", baseURL)
		fmt.Printf("Token: %s\n", token)
		return
	}

	loginURL := fmt.Sprintf("%s/login?token=%s",
		baseURL, url.QueryEscape(token))

	fmt.Printf("Opening: %s\n", baseURL)
	if err := openBrowser(loginURL); err != nil {
		fmt.Printf("\nCould not open browser automatically.\n")
		fmt.Printf("Open this URL in your browser:\n")
		fmt.Printf("  %s/login?token=%s\n", baseURL, token)
		fmt.Printf("\nNote: make sure bothouse is running (it hosts the web admin on port %d).\n", port)
	}
}

func openBrowser(rawURL string) error {
	name, args, err := browserCommand(runtime.GOOS, isWSL(), exec.LookPath, rawURL)
	if err != nil {
		return err
	}
	return exec.Command(name, args...).Start()
}

// browserCommand picks the command that opens rawURL. On Windows (and from WSL) it uses
// rundll32 url.dll,FileProtocolHandler instead of `cmd /c start`: cmd.exe treats the "&" in
// a link such as /login?token=…&next=/setup as a command separator and opens a cut-off URL.
func browserCommand(goos string, wsl bool, lookPath func(string) (string, error), rawURL string) (string, []string, error) {
	switch goos {
	case "darwin":
		return "open", []string{rawURL}, nil
	case "linux":
		if wsl {
			return "rundll32.exe", []string{"url.dll,FileProtocolHandler", rawURL}, nil
		}
		// On headless Linux, xdg-open is often unavailable.
		// Check early and return a clear error so the caller can print the URL.
		if _, err := lookPath("xdg-open"); err != nil {
			return "", nil, fmt.Errorf("xdg-open not found (headless server?): %w", err)
		}
		return "xdg-open", []string{rawURL}, nil
	case "windows":
		return "rundll32", []string{"url.dll,FileProtocolHandler", rawURL}, nil
	default:
		return "", nil, fmt.Errorf("unsupported OS: %s", goos)
	}
}

func isWSL() bool {
	data, err := os.ReadFile("/proc/version")
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToLower(string(data)), "microsoft")
}
