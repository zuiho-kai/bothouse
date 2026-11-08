package core

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

type managementConnectionKey struct{}

// Observe the existing server, retaining callbacks installed by its caller.
// Connection ids join the request trace to net/http's lifecycle without URLs,
// request bodies, credentials or remote addresses in the diagnostic log.
func observeManagementConnections(server *http.Server) {
	previousContext, previousState := server.ConnContext, server.ConnState
	server.ConnContext = func(ctx context.Context, conn net.Conn) context.Context {
		if previousContext != nil {
			ctx = previousContext(ctx, conn)
		}
		return context.WithValue(ctx, managementConnectionKey{}, fmt.Sprintf("%p", conn))
	}
	server.ConnState = func(conn net.Conn, state http.ConnState) {
		slog.Info("management api connection state", "connection", fmt.Sprintf("%p", conn), "state", state.String(), "pid", os.Getpid())
		if previousState != nil {
			previousState(conn, state)
		}
	}
}

func traceDSHRequest(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Bothouse-Request-Id")
		if id == "" {
			id = r.Header.Get("X-Request-Id")
		}
		// Source: windows_e2e.rework-rid.py _request_id uses this alphabet.
		// Reject other characters rather than logging token URLs or control text.
		if strings.IndexFunc(id, func(c rune) bool {
			return !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.ContainsRune("_.-", c))
		}) >= 0 {
			id = ""
		}
		connection, _ := r.Context().Value(managementConnectionKey{}).(string)
		logger := slog.Default().With("request_id", id, "connection", connection, "pid", os.Getpid(), "path", r.URL.Path, "method", r.Method)
		started := time.Now()
		logger.Info("management dsh request started")
		response := &dshTraceResponse{ResponseWriter: w, logger: logger, status: http.StatusOK}
		defer func() {
			logger.Info("management dsh request ended", "status", response.status, "elapsed", time.Since(started), "context_error", r.Context().Err())
		}()
		next(response, r)
	}
}

type dshTraceResponse struct {
	http.ResponseWriter
	logger      *slog.Logger
	status      int
	wroteHeader bool
}

func (w *dshTraceResponse) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *dshTraceResponse) WriteHeader(status int) {
	if !w.wroteHeader {
		w.status, w.wroteHeader = status, true
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *dshTraceResponse) Write(body []byte) (int, error) {
	w.wroteHeader = true
	n, err := w.ResponseWriter.Write(body)
	if err != nil {
		w.logger.Error("management dsh response write failed", "error", err)
	}
	return n, err
}
