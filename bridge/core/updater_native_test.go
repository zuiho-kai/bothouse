package core

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestReleaseAssetNamesSingleDownload(t *testing.T) {
	for _, arch := range []string{"amd64", "arm64"} {
		for goos, want := range map[string]string{
			"darwin": "bothouse-mac.dmg", "windows": "bothouse-windows.exe",
			"linux": map[string]string{"amd64": "bothouse-linux-x64", "arm64": "bothouse-linux-arm64"}[arch],
		} {
			t.Run(goos+"/"+arch, func(t *testing.T) {
				if got := ReleaseAssetNames("v0.1.2", goos, arch)[0]; got != want {
					t.Fatalf("preferred download = %s, want %s", got, want)
				}
			})
		}
	}
}

func TestBothouseUpdateNativeAndLegacyFallback(t *testing.T) {
	for _, goos := range []string{"linux", "windows", "darwin"} {
		for _, arch := range []string{"amd64", "arm64"} {
			for _, scenario := range []string{"native", "old-native", "legacy", "tampered", "missing-sums", "unlisted"} {
				t.Run(goos+"/"+arch+"/"+scenario, func(t *testing.T) {
					native := map[string]string{"darwin": "bothouse-mac.dmg", "windows": "bothouse-windows.exe", "linux": "bothouse-linux-" + arch}[goos]
					if goos == "linux" && arch == "amd64" {
						native = "bothouse-linux-x64"
					}
					oldNative := "bothouse-" + goos + "-" + arch
					legacy := "cc-connect-v0.1.1-" + goos + "-" + arch + ".tar.gz"
					if goos == "windows" {
						oldNative += ".exe"
						legacy = "cc-connect-v0.1.1-windows-" + arch + ".zip"
					}
					if goos == "darwin" {
						oldNative += ".dmg"
					}
					selected := native
					attempted := []string{native}
					if scenario == "old-native" || scenario == "legacy" {
						if oldNative != native {
							attempted = append(attempted, oldNative)
						}
						selected = oldNative
					}
					if scenario == "legacy" {
						selected = legacy
						attempted = append(attempted, legacy)
					}
					sumsName := "SHA256SUMS"
					payload := "native executable"
					if selected == legacy {
						sumsName = "checksums.txt"
						payload = "legacy archive"
					}
					var requests []string
					server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						name := strings.TrimPrefix(r.URL.Path, "/v0.1.1/")
						requests = append(requests, name)
						switch name {
						case selected:
							fmt.Fprint(w, payload)
						case sumsName:
							if scenario == "missing-sums" {
								http.NotFound(w, r)
								return
							}
							data := payload
							if scenario == "tampered" {
								data = "unmodified executable"
							}
							sumName := selected
							if scenario == "unlisted" {
								sumName = "other-file"
							}
							fmt.Fprintf(w, "%x  %s\n", sha256.Sum256([]byte(data)), sumName)
						default:
							http.NotFound(w, r)
						}
					}))
					defer server.Close()
					data, name, err := DownloadReleaseAsset([]string{server.URL}, "v0.1.1", goos, arch)
					switch scenario {
					case "native", "old-native", "legacy":
						if err != nil || name != selected || string(data) != payload {
							t.Fatalf("%q %q %v", data, name, err)
						}
					default:
						if err == nil {
							t.Fatal("unverified executable accepted")
						}
					}
					wantRequests := append(attempted, sumsName)
					if !reflect.DeepEqual(requests, wantRequests) {
						t.Fatalf("requests = %v, want %v", requests, wantRequests)
					}
				})
			}
		}
	}
}

func TestExtractReleaseBinaryNativeAndLegacy(t *testing.T) {
	payload := []byte("executable bytes")
	var tgz, zipped bytes.Buffer
	gz := gzip.NewWriter(&tgz)
	tw := tar.NewWriter(gz)
	if err := tw.WriteHeader(&tar.Header{Name: "cc-connect", Mode: 0755, Size: int64(len(payload))}); err != nil {
		t.Fatal(err)
	}
	tw.Write(payload)
	tw.Close()
	gz.Close()
	zw := zip.NewWriter(&zipped)
	entry, err := zw.Create("bothouse.exe")
	if err != nil {
		t.Fatal(err)
	}
	entry.Write(payload)
	zw.Close()
	for _, tt := range []struct {
		name string
		data []byte
	}{
		{"bothouse-linux-x64", payload}, {"bothouse-linux-arm64", payload}, {"bothouse-windows.exe", payload},
		{"cc-connect-v0.1.1-darwin-arm64.tar.gz", tgz.Bytes()}, {"cc-connect-v0.1.1-windows-arm64.zip", zipped.Bytes()},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ExtractReleaseBinary(tt.data, tt.name)
			if err != nil || !bytes.Equal(got, payload) {
				t.Fatalf("%q %v", got, err)
			}
		})
	}
}
