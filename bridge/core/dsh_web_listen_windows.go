//go:build windows

package core

import (
	"context"
	"encoding/binary"
	"strconv"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Windows has no lsof: the listening sockets and their owners come from the IPv4 TCP table
// (iphlpapi GetExtendedTcpTable, TCP_TABLE_OWNER_PID_LISTENER). Without a pid the self-heal wrote
// pid 0, the next request saw that as stale and healed again — a log read, a probe and a backup
// file on every proxied request.

var procGetExtendedTcpTable = windows.NewLazySystemDLL("iphlpapi.dll").NewProc("GetExtendedTcpTable")

// tcpListener is one row of MIB_TCPROW_OWNER_PID (Win32 docs): six DWORDs.
type tcpListener struct {
	addr [4]byte
	port int
	pid  int
}

func tcpListeners() []tcpListener {
	const afInet = 2                   // AF_INET
	const tcpTableOwnerPidListener = 3 // TCP_TABLE_OWNER_PID_LISTENER
	size := uint32(0)
	var buf []byte
	for i := 0; i < 4; i++ {
		var p uintptr
		if len(buf) > 0 {
			p = uintptr(unsafe.Pointer(&buf[0]))
		}
		r, _, _ := procGetExtendedTcpTable.Call(p, uintptr(unsafe.Pointer(&size)), 0, afInet, tcpTableOwnerPidListener, 0)
		if r == 0 && len(buf) > 0 {
			break
		}
		if r != uintptr(windows.ERROR_INSUFFICIENT_BUFFER) && r != 0 {
			return nil
		}
		buf = make([]byte, size)
	}
	if len(buf) < 4 {
		return nil
	}
	n := int(binary.LittleEndian.Uint32(buf))
	const row = 24
	list := make([]tcpListener, 0, n)
	for i := 0; i < n && 4+(i+1)*row <= len(buf); i++ {
		r := buf[4+i*row:]
		var l tcpListener
		copy(l.addr[:], r[4:8])           // dwLocalAddr, network order
		l.port = int(r[8])<<8 | int(r[9]) // dwLocalPort: low 16 bits, network order
		l.pid = int(binary.LittleEndian.Uint32(r[20:24]))
		list = append(list, l)
	}
	return list
}

// dshWebListenersCtx: the same table read, shaped like the unix helper so the callers can share one
// signature. The Windows call is a plain syscall and cannot hang, so ctx is not consulted.
func dshWebListenersCtx(context.Context) []string { return dshWebListeners() }

// pidListeningOnPortCtx: pidListeningOnPort, likewise a syscall with nothing to interrupt.
func pidListeningOnPortCtx(_ context.Context, port string) int { return pidListeningOnPort(port) }

// dshWebListeners: loopback (127.0.0.1) listening ports, as on unix.
func dshWebListeners() []string {
	seen := make(map[int]bool)
	list := make([]string, 0, 4)
	for _, l := range tcpListeners() {
		if l.addr != [4]byte{127, 0, 0, 1} || seen[l.port] {
			continue
		}
		seen[l.port] = true
		list = append(list, strconv.Itoa(l.port))
	}
	return list
}

// pidListeningOnPort: the pid listening on port (loopback or any address), or 0.
func pidListeningOnPort(port string) int {
	want, err := strconv.Atoi(port)
	if err != nil {
		return 0
	}
	for _, l := range tcpListeners() {
		if l.port == want && l.pid > 0 && (l.addr == [4]byte{127, 0, 0, 1} || l.addr == [4]byte{}) {
			return l.pid
		}
	}
	return 0
}
