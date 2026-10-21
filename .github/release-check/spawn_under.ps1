# Start a command as a child of another process (PROC_THREAD_ATTRIBUTE_PARENT_PROCESS), to act
# like an agent CLI that cc-connect started. Used by release.yml verify-windows. Prints the PID.
param([Parameter(Mandatory)][int]$ParentId, [Parameter(Mandatory)][string]$CommandLine)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SpawnUnder {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO { public int cb; public string lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)]
  struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attr, IntPtr value, IntPtr size, IntPtr prev, IntPtr ret);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
  public static int Run(int parentPid, string cmdline) {
    IntPtr size = IntPtr.Zero;
    InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
    IntPtr list = Marshal.AllocHGlobal(size);
    if (!InitializeProcThreadAttributeList(list, 1, 0, ref size)) throw new Exception("InitializeProcThreadAttributeList " + Marshal.GetLastWin32Error());
    IntPtr parent = OpenProcess(0x0080, false, parentPid); // PROCESS_CREATE_PROCESS
    if (parent == IntPtr.Zero) throw new Exception("OpenProcess " + Marshal.GetLastWin32Error());
    IntPtr value = Marshal.AllocHGlobal(IntPtr.Size);
    Marshal.WriteIntPtr(value, parent);
    if (!UpdateProcThreadAttribute(list, 0, (IntPtr)0x00020000, value, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero)) throw new Exception("UpdateProcThreadAttribute " + Marshal.GetLastWin32Error()); // PROC_THREAD_ATTRIBUTE_PARENT_PROCESS
    var si = new STARTUPINFOEX();
    si.StartupInfo.cb = Marshal.SizeOf(si);
    si.lpAttributeList = list;
    PROCESS_INFORMATION pi;
    if (!CreateProcess(null, cmdline, IntPtr.Zero, IntPtr.Zero, false, 0x00080000 | 0x08000000, IntPtr.Zero, null, ref si, out pi)) throw new Exception("CreateProcess " + Marshal.GetLastWin32Error()); // EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW
    return pi.dwProcessId;
  }
}
'@
[SpawnUnder]::Run($ParentId, $CommandLine)
