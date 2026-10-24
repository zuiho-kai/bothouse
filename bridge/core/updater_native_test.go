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

func TestBothouseUpdateNativeDownload(t *testing.T) {
	for _, goos := range []string{"linux", "windows", "darwin"} {
		for _, arch := range []string{"amd64", "arm64"} {
			for _, scenario := range []string{"native", "tampered", "missing-sums", "unlisted"} {
				t.Run(goos+"/"+arch+"/"+scenario, func(t *testing.T) {
					native := map[string]string{"darwin": "bothouse-mac.dmg", "windows": "bothouse-windows.exe", "linux": "bothouse-linux-" + arch}[goos]
					if goos == "linux" && arch == "amd64" {
						native = "bothouse-linux-x64"
					}
					payload := "native executable"
					var requests []string
					server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						name := strings.TrimPrefix(r.URL.Path, "/v0.1.1/")
						requests = append(requests, name)
						switch name {
						case native:
							fmt.Fprint(w, payload)
						case "SHA256SUMS":
							if scenario == "missing-sums" {
								http.NotFound(w, r)
								return
							}
							data := payload
							if scenario == "tampered" {
								data = "unmodified executable"
							}
							sumName := native
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
					if scenario == "native" {
						if err != nil || name != native || string(data) != payload {
							t.Fatalf("%q %q %v", data, name, err)
						}
					} else if err == nil {
						t.Fatal("unverified executable accepted")
					}
					// Only names the release workflow publishes are requested.
					if want := []string{native, "SHA256SUMS"}; !reflect.DeepEqual(requests, want) {
						t.Fatalf("requests = %v, want %v", requests, want)
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
