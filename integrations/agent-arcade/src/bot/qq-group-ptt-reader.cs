// Read an existing Windows disk file through a chain of held, non-following
// handles. Input is supplied by the application on stdin; nothing is enumerated.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

public static class ArcadePttOriginal {
    const uint ReadAttributes=0x80, Synchronize=0x100000, Traverse=0x20, ReadData=1;
    const uint ShareRead=1, ShareWrite=2, OpenExisting=3, BackupSemantics=0x02000000;
    const uint OpenReparse=0x00200000, Directory=0x10, Reparse=0x400;
    const uint NtOpen=1, NtDirectory=1, NtFile=0x40, NtSync=0x20;
    const uint DontReparse=0x1000;
    [StructLayout(LayoutKind.Sequential)] struct NativeString { public ushort Length, MaximumLength; public IntPtr Buffer; }
    [StructLayout(LayoutKind.Sequential)] struct Attributes {
        public int Length; public IntPtr Root,Name; public uint Flags; public IntPtr Security,Qos;
    }
    [StructLayout(LayoutKind.Sequential)] struct Result { public IntPtr Status,Information; }
    [StructLayout(LayoutKind.Sequential)] struct Info {
        public uint Attr;
        public System.Runtime.InteropServices.ComTypes.FILETIME Born,Accessed,Written;
        public uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;
    }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern uint GetDriveTypeW(string path);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern SafeFileHandle CreateFileW(
        string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
    [DllImport("kernel32.dll")] static extern uint GetFileType(SafeFileHandle file);
    [DllImport("kernel32.dll")] static extern bool GetFileInformationByHandle(SafeFileHandle file,out Info info);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern uint GetFinalPathNameByHandleW(
        SafeFileHandle file,StringBuilder name,uint capacity,uint flags);
    [DllImport("ntdll.dll")] static extern int NtCreateFile(out SafeFileHandle file,uint access,ref Attributes attr,
        out Result result,IntPtr alloc,uint fileAttr,uint share,uint disposition,uint options,IntPtr ea,uint eaLength);

    static void Require(bool ok) { if(!ok)throw new IOException(); }
    static string PathLine() {
        string line=Console.ReadLine(); Require(line!=null && line.Length<=22000);
        string value=new UTF8Encoding(false,true).GetString(Convert.FromBase64String(line));
        Require(value.Length>=4 && value.Length<=4096 && Regex.IsMatch(value,@"^[A-Za-z]:\\"));
        return value;
    }
    static void CheckName(string name) {
        Require(name.Length>0 && name.Length<=255 && !name.EndsWith(" ") && !name.EndsWith(".") &&
          name.IndexOfAny(Path.GetInvalidFileNameChars())<0 &&
          !Regex.IsMatch(name,@"^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|(LPT|COM)[0-9¹²³])(\.|$)",RegexOptions.IgnoreCase));
    }
    static Info Check(SafeFileHandle file,string path,bool directory) {
        Info info;
        Require(!file.IsInvalid && GetFileType(file)==1);
        Require(GetFileInformationByHandle(file,out info) && (info.Attr & Reparse)==0 &&
          ((info.Attr & Directory)!=0)==directory && (directory || info.Links==1));
        var name=new StringBuilder(8192);
        uint len=GetFinalPathNameByHandleW(file,name,(uint)name.Capacity,0);
        Require(len>0 && len<name.Capacity &&
            String.Equals(name.ToString(),@"\\?\"+path,StringComparison.OrdinalIgnoreCase));
        return info;
    }
    static SafeFileHandle OpenChild(SafeFileHandle parent,string name,bool directory) {
        // Each name is a single component relative to the actual parent handle.
        // Earlier directory handles remain open without delete sharing.
        CheckName(name);
        IntPtr chars=Marshal.StringToHGlobalUni(name),pointer=IntPtr.Zero;
        try {
            ushort length=checked((ushort)(name.Length*2));
            var text=new NativeString {Length=length,MaximumLength=length,Buffer=chars};
            pointer=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(NativeString))); Marshal.StructureToPtr(text,pointer,false);
            var attr=new Attributes {Length=Marshal.SizeOf(typeof(Attributes)),Root=parent.DangerousGetHandle(),
                Name=pointer,Flags=DontReparse};
            Result result; SafeFileHandle child;
            int status=NtCreateFile(out child,ReadAttributes|Synchronize|(directory?Traverse:ReadData),ref attr,
                out result,IntPtr.Zero,0,directory?ShareRead|ShareWrite:ShareRead,NtOpen,
                NtSync|OpenReparse|(directory?NtDirectory:NtFile),IntPtr.Zero,0);
            if(status<0 || child==null || child.IsInvalid) { if(child!=null)child.Dispose(); throw new IOException(); }
            return child;
        } finally {
            if(pointer!=IntPtr.Zero)Marshal.FreeHGlobal(pointer);
            Marshal.FreeHGlobal(chars);
        }
    }
    public static int Read() {
        var handles=new List<SafeFileHandle>(); byte[] bytes=null;
        try {
            string root=PathLine(),file=PathLine();
            Require(file.StartsWith(root+@"\",StringComparison.Ordinal));
            int size=Int32.Parse(Console.ReadLine());string sha1=Console.ReadLine();
            Require(size>=1 && size<=512*1024 && Regex.IsMatch(sha1,"^[a-f0-9]{40}$"));
            string drive=file.Substring(0,3);Require(GetDriveTypeW(drive)==3);
            SafeFileHandle handle=CreateFileW(drive,ReadAttributes|Traverse,ShareRead|ShareWrite,IntPtr.Zero,
                OpenExisting,BackupSemantics|OpenReparse,IntPtr.Zero);
            handles.Add(handle); Check(handle,drive,true);
            string[] names=file.Substring(3).Split('\\'); Require(names.Length<=64);
            string current=drive;
            for(int i=0;i<names.Length;i++) {
                bool dir=i!=names.Length-1;
                handle=OpenChild(handle,names[i],dir); handles.Add(handle);
                current=Path.Combine(current,names[i]);
                var info=Check(handle,current,dir);
                if(!dir && (info.SizeHigh!=0 || info.SizeLow!=size))return 3;
            }
            bytes=new byte[size];
            using(var reader=new FileStream(handle,FileAccess.Read)) {
                int used=0;
                while(used<size) { int n=reader.Read(bytes,used,size-used);Require(n>0);used+=n; }
                if(reader.ReadByte()!=-1)return 3;
                var end=Check(handle,current,false);
                if(end.SizeHigh!=0 || end.SizeLow!=size)return 3;
                using(var hash=SHA1.Create())
                    if(!String.Equals(BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-",""),sha1,StringComparison.OrdinalIgnoreCase))return 3;
                using(var output=Console.OpenStandardOutput())output.Write(bytes,0,bytes.Length);
            }
            return 0;
        } catch {return 2;}
        finally {
            if(bytes!=null)Array.Clear(bytes,0,bytes.Length);
            for(int i=handles.Count-1;i>=0;i--)handles[i].Dispose();
        }
    }
}
