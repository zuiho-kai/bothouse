// Original Win32 interop host, based on Microsoft's documented WebAuthn ABI.
// No credential enumeration, deletion, network access, or authenticator settings.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
[assembly: DefaultDllImportSearchPaths(DllImportSearchPath.System32)]

public static class ArcadeWebAuthnHost {
 [StructLayout(LayoutKind.Sequential)] struct Rp { public uint version; public IntPtr id,name,icon; }
 [StructLayout(LayoutKind.Sequential)] struct User { public uint version,size; public IntPtr data,name,icon,displayName; }
 [StructLayout(LayoutKind.Sequential)] struct ClientData { public uint version,size; public IntPtr data,hash; }
 [StructLayout(LayoutKind.Sequential)] struct Cose { public uint version; public IntPtr type; public int algorithm; }
 [StructLayout(LayoutKind.Sequential)] struct List { public uint count; public IntPtr items; }
 [StructLayout(LayoutKind.Sequential)] struct Credential { public uint version,size; public IntPtr data,type; }
 [StructLayout(LayoutKind.Sequential)] struct CredentialEx { public uint version,size; public IntPtr data,type; public uint transports; }
 // Make v3 and Get v4 are supported by WebAuthn API 1. Do not pass latest-header versions blindly.
 [StructLayout(LayoutKind.Sequential)] struct MakeOptions { public uint version,timeout; public List credentials,extensions; public uint attachment; public int resident; public uint verification,attestation,flags; public IntPtr cancellation,exclude; }
 [StructLayout(LayoutKind.Sequential)] struct GetOptions { public uint version,timeout; public List credentials,extensions; public uint attachment,verification,flags; public IntPtr appId,appIdUsed,cancellation,allow; }
 // Read only the documented v1 prefixes; free with the matching Windows function.
 [StructLayout(LayoutKind.Sequential)] struct Attestation { public uint version; public IntPtr format; public uint authSize; public IntPtr auth; public uint attSize; public IntPtr att; public uint decode; public IntPtr decoded; public uint objectSize; public IntPtr obj; public uint credentialSize; public IntPtr credential; }
 [StructLayout(LayoutKind.Sequential)] struct Assertion { public uint version,authSize; public IntPtr auth; public uint signatureSize; public IntPtr signature; public Credential credential; public uint userSize; public IntPtr user; }
 [DllImport("webauthn.dll",ExactSpelling=true)] static extern uint WebAuthNGetApiVersionNumber();
 [DllImport("webauthn.dll",ExactSpelling=true)] static extern int WebAuthNIsUserVerifyingPlatformAuthenticatorAvailable(out int available);
 [DllImport("webauthn.dll",ExactSpelling=true)] static extern int WebAuthNGetCancellationId(out Guid id);
 [DllImport("webauthn.dll",ExactSpelling=true)] static extern int WebAuthNCancelCurrentOperation(ref Guid id);
 [DllImport("webauthn.dll",ExactSpelling=true)] static extern int WebAuthNAuthenticatorMakeCredential(IntPtr window,ref Rp rp,ref User user,ref List algorithms,ref ClientData client,ref MakeOptions options,out IntPtr result);
 [DllImport("webauthn.dll",ExactSpelling=true,CharSet=CharSet.Unicode)] static extern int WebAuthNAuthenticatorGetAssertion(IntPtr window,string rpId,ref ClientData client,ref GetOptions options,out IntPtr result);
 [DllImport("webauthn.dll",ExactSpelling=true)] static extern void WebAuthNFreeCredentialAttestation(IntPtr result);
 [DllImport("webauthn.dll",ExactSpelling=true)] static extern void WebAuthNFreeAssertion(IntPtr result);
 [DllImport("user32.dll",ExactSpelling=true)] static extern int IsWindow(IntPtr window);
 [DllImport("user32.dll",ExactSpelling=true)] static extern int IsWindowVisible(IntPtr window);
 [DllImport("user32.dll",ExactSpelling=true)] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);

 sealed class NativeFailure : Exception { public string Code; public NativeFailure(string code){Code=code;} }
 sealed class Arena : IDisposable {
  readonly System.Collections.Generic.List<IntPtr> pointers=new System.Collections.Generic.List<IntPtr>();
  public IntPtr Allocate(int count){IntPtr p=Marshal.AllocHGlobal(count);pointers.Add(p);return p;}
  public IntPtr Bytes(byte[] bytes){IntPtr p=Allocate(bytes.Length);Marshal.Copy(bytes,0,p,bytes.Length);return p;}
  public IntPtr Text(string value){IntPtr p=Marshal.StringToHGlobalUni(value);pointers.Add(p);return p;}
  public IntPtr Structure(object value){IntPtr p=Allocate(Marshal.SizeOf(value));Marshal.StructureToPtr(value,p,false);return p;}
  public void Dispose(){foreach(IntPtr p in pointers)Marshal.FreeHGlobal(p);pointers.Clear();}
 }
 sealed class Operation {
  public string Id,Kind; public Dictionary<string,object> Input; public Guid Cancellation;
  public volatile bool CancelRequested,Invoked,Finished; public IntPtr Window; public uint Owner;
  public readonly ManualResetEvent Done=new ManualResetEvent(false); public Thread Thread;
 }
 static readonly object gate=new object(),outputGate=new object();
 static string nonce; static Operation active; static bool shuttingDown; static uint apiVersion; static bool abi;
 static JavaScriptSerializer Serializer(){return new JavaScriptSerializer {MaxJsonLength=131072,RecursionLimit=16};}
 static Dictionary<string,object> Map(object value){var result=value as Dictionary<string,object>;if(result==null)throw new NativeFailure("webauthn_invalid_request");return result;}
 static string Text(Dictionary<string,object> m,string key,int max){object value; if(!m.TryGetValue(key,out value)||!(value is string)||((string)value).Length>max)throw new NativeFailure("webauthn_invalid_request");return (string)value;}
 static int Number(Dictionary<string,object> m,string key,int min,int max){object value;if(!m.TryGetValue(key,out value)||!(value is int)||((int)value)<min||((int)value)>max)throw new NativeFailure("webauthn_invalid_request");return (int)value;}
 static void Exact(Dictionary<string,object> m,params string[] keys){if(m.Count!=keys.Length)throw new NativeFailure("webauthn_invalid_request");foreach(string key in keys)if(!m.ContainsKey(key))throw new NativeFailure("webauthn_invalid_request");}
 static byte[] Decode(string s,int min,int max){if(s.Length>Math.Ceiling(max*4.0/3.0))throw new NativeFailure("webauthn_invalid_request");foreach(char c in s)if(!(c>='A'&&c<='Z'||c>='a'&&c<='z'||c>='0'&&c<='9'||c=='_'||c=='-'))throw new NativeFailure("webauthn_invalid_request");byte[] b;try{b=Convert.FromBase64String(s.Replace('-','+').Replace('_','/')+new string('=',(4-s.Length%4)%4));}catch{throw new NativeFailure("webauthn_invalid_request");}if(b.Length<min||b.Length>max||Encode(b)!=s)throw new NativeFailure("webauthn_invalid_request");return b;}
 static string Encode(byte[] b){return Convert.ToBase64String(b).TrimEnd('=').Replace('+','-').Replace('/','_');}
 static byte[] Copy(IntPtr pointer,uint size,int min,int max){if(size<min||size>max||pointer==IntPtr.Zero)throw new NativeFailure("webauthn_response_invalid");byte[] b=new byte[(int)size];Marshal.Copy(pointer,b,0,b.Length);return b;}
 static void Write(Dictionary<string,object> value){value["nonce"]=nonce;string json=Serializer().Serialize(value);if(Encoding.UTF8.GetByteCount(json)>131072)throw new NativeFailure("webauthn_response_invalid");lock(outputGate){Console.Out.WriteLine(json);Console.Out.Flush();}}
 static string ReadLine(){StringBuilder b=new StringBuilder();for(;;){int c=Console.In.Read();if(c<0)return b.Length==0?null:b.ToString();if(c==10)return b.ToString();if(b.Length>=131072)throw new NativeFailure("webauthn_invalid_request");b.Append((char)c);}}
 static Dictionary<string,object> Obj(params object[] pairs){var result=new Dictionary<string,object>();for(int i=0;i<pairs.Length;i+=2)result[(string)pairs[i]]=pairs[i+1];return result;}
 static bool Offset(Type type,string field,int x64,int x86){return Marshal.OffsetOf(type,field).ToInt32()==(IntPtr.Size==8?x64:x86);}
 static bool Size(Type type,int x64,int x86){return Marshal.SizeOf(type)==(IntPtr.Size==8?x64:x86);}
 static bool Abi(){
  return (IntPtr.Size==8||IntPtr.Size==4)&&Size(typeof(Rp),32,16)&&Offset(typeof(Rp),"id",8,4)&&Size(typeof(User),40,24)&&Offset(typeof(User),"displayName",32,20)&&Size(typeof(ClientData),24,16)&&Offset(typeof(ClientData),"hash",16,12)&&Size(typeof(Cose),24,12)&&Offset(typeof(Cose),"algorithm",16,8)&&Size(typeof(List),16,8)&&Size(typeof(Credential),24,16)&&Size(typeof(CredentialEx),32,20)&&Offset(typeof(CredentialEx),"transports",24,16)&&Size(typeof(MakeOptions),80,52)&&Offset(typeof(MakeOptions),"credentials",8,8)&&Offset(typeof(MakeOptions),"extensions",24,16)&&Offset(typeof(MakeOptions),"resident",44,28)&&Offset(typeof(MakeOptions),"cancellation",64,44)&&Offset(typeof(MakeOptions),"exclude",72,48)&&Size(typeof(GetOptions),88,52)&&Offset(typeof(GetOptions),"appId",56,36)&&Offset(typeof(GetOptions),"cancellation",72,44)&&Offset(typeof(GetOptions),"allow",80,48)&&Size(typeof(Attestation),96,48)&&Offset(typeof(Attestation),"obj",72,36)&&Offset(typeof(Attestation),"credential",88,44)&&Size(typeof(Assertion),72,44)&&Offset(typeof(Assertion),"credential",32,20)&&Offset(typeof(Assertion),"user",64,40);
 }
 static Dictionary<string,object> Availability(){
  abi=Abi();bool supported=false,available=false;apiVersion=0;
  if(abi)try{apiVersion=WebAuthNGetApiVersionNumber();if(apiVersion>=1){int flag;int hr=WebAuthNIsUserVerifyingPlatformAuthenticatorAvailable(out flag);Guid id;if(hr==0&&WebAuthNGetCancellationId(out id)==0){supported=true;available=flag!=0;}}}catch(DllNotFoundException){}catch(EntryPointNotFoundException){}catch(BadImageFormatException){}
  return Obj("protocol",1,"supported",supported,"apiVersion",apiVersion,"platformAuthenticatorAvailable",available,"abiVerified",abi);
 }
 static bool WindowOwned(Operation op){uint actual;return op.Window!=IntPtr.Zero&&IsWindow(op.Window)!=0&&IsWindowVisible(op.Window)!=0&&GetWindowThreadProcessId(op.Window,out actual)!=0&&actual==op.Owner;}
 static void RequestCancel(Operation op){op.CancelRequested=true;if(op.Invoked&&!op.Finished)try{Guid id=op.Cancellation;WebAuthNCancelCurrentOperation(ref id);}catch{}}
 static void Tick(Operation op){if(op.Finished)return;if(!WindowOwned(op))op.CancelRequested=true;if(op.CancelRequested)RequestCancel(op);}
 static void Validate(Operation op){
  var m=op.Input;string origin=Text(m,"origin",2048),rp=Text(m,"rpId",253);Uri u;
  if(!Uri.TryCreate(origin,UriKind.Absolute,out u)||u.Scheme!="https"||u.GetLeftPart(UriPartial.Authority)!=origin||u.Host!=rp||u.HostNameType!=UriHostNameType.Dns||rp.IndexOf('.')<0||u.UserInfo.Length!=0||u.PathAndQuery!="/"||u.Fragment.Length!=0)throw new NativeFailure("webauthn_invalid_request");
  Decode(Text(m,"challenge",172),16,128);Number(m,"timeout",1,120000);op.Owner=(uint)Number(m,"ownerPid",1,Int32.MaxValue);
  string hwnd=Text(m,"parentHwnd",18);ulong raw;if(!hwnd.StartsWith("0x")||!UInt64.TryParse(hwnd.Substring(2),System.Globalization.NumberStyles.HexNumber,null,out raw)||raw==0||IntPtr.Size==4&&raw>UInt32.MaxValue)throw new NativeFailure("webauthn_invalid_request");op.Window=new IntPtr(unchecked((long)raw));
  if(!WindowOwned(op))throw new NativeFailure("webauthn_changed");
 }
 static IntPtr Credentials(Arena arena,object raw){
  var rows=raw as object[];if(rows==null||rows.Length>64)throw new NativeFailure("webauthn_invalid_request");if(rows.Length==0)return IntPtr.Zero;
  IntPtr pointers=arena.Allocate(rows.Length*IntPtr.Size);var ids=new HashSet<string>();
  for(int i=0;i<rows.Length;i++){var row=Map(rows[i]);Exact(row,"id","transports");string id=Text(row,"id",1366);byte[] data=Decode(id,1,1024);if(!ids.Add(id))throw new NativeFailure("webauthn_invalid_request");uint transports=(uint)Number(row,"transports",0,119);if((transports&8)!=0)throw new NativeFailure("webauthn_invalid_request");var credential=new CredentialEx {version=1,size=(uint)data.Length,data=arena.Bytes(data),type=arena.Text("public-key"),transports=transports};Marshal.WriteIntPtr(pointers,i*IntPtr.Size,arena.Structure(credential));}
  return arena.Structure(new List {count=(uint)rows.Length,items=pointers});
 }
 static Dictionary<string,object> Ceremony(Operation op){
  if(!abi)throw new NativeFailure("webauthn_abi_invalid");if(apiVersion<1)throw new NativeFailure("webauthn_unavailable");Validate(op);
  var m=op.Input;string origin=Text(m,"origin",2048),rpId=Text(m,"rpId",253),challenge=Text(m,"challenge",172);
  byte[] clientBytes=Encoding.UTF8.GetBytes(Serializer().Serialize(Obj("type","webauthn."+op.Kind,"challenge",challenge,"origin",origin,"crossOrigin",false)));
  using(var arena=new Arena()){
   var client=new ClientData {version=1,size=(uint)clientBytes.Length,data=arena.Bytes(clientBytes),hash=arena.Text("SHA-256")};
   IntPtr credentials=Credentials(arena,m["credentials"]);IntPtr cancellation=arena.Structure(op.Cancellation);uint timeout=(uint)Number(m,"timeout",1,120000);IntPtr result=IntPtr.Zero;int hr;
   using(var timer=new Timer(delegate(object state){Tick(op);},null,0,50)){
    try{
     if(op.Kind=="create"){
      byte[] userBytes=Decode(Text(m,"userId",86),1,64);if(Encoding.UTF8.GetString(userBytes)!="napcat-user")throw new NativeFailure("webauthn_invalid_request");
      var rp=new Rp {version=1,id=arena.Text(rpId),name=arena.Text("NapCat WebUI")};var user=new User {version=1,size=(uint)userBytes.Length,data=arena.Bytes(userBytes),name=arena.Text("NapCat User"),displayName=arena.Text("")};
      var algorithms=m["algorithms"] as object[];if(algorithms==null||algorithms.Length<1||algorithms.Length>2)throw new NativeFailure("webauthn_options_unsupported");var seen=new HashSet<int>();int stride=Marshal.SizeOf(typeof(Cose));IntPtr array=arena.Allocate(algorithms.Length*stride);
      for(int i=0;i<algorithms.Length;i++){if(!(algorithms[i] is int))throw new NativeFailure("webauthn_options_unsupported");int alg=(int)algorithms[i];if(alg!=-7&&alg!=-257||!seen.Add(alg))throw new NativeFailure("webauthn_options_unsupported");Marshal.StructureToPtr(new Cose {version=1,type=arena.Text("public-key"),algorithm=alg},IntPtr.Add(array,i*stride),false);}
      var cose=new List {count=(uint)algorithms.Length,items=array};var options=new MakeOptions {version=3,timeout=timeout,verification=2,attestation=1,cancellation=cancellation,exclude=credentials};
      // Last check on the same operation immediately before entering Windows.
      if(op.CancelRequested)throw new NativeFailure("webauthn_cancelled");if(!WindowOwned(op))throw new NativeFailure("webauthn_changed");op.Invoked=true;Write(Obj("event","started","operationId",op.Id));
      hr=WebAuthNAuthenticatorMakeCredential(op.Window,ref rp,ref user,ref cose,ref client,ref options,out result);
      if(hr!=0)throw new NativeFailure(op.CancelRequested?"webauthn_cancelled":"webauthn_native_failed");if(result==IntPtr.Zero)throw new NativeFailure("webauthn_response_invalid");
      var att=(Attestation)Marshal.PtrToStructure(result,typeof(Attestation));if(att.version<1)throw new NativeFailure("webauthn_response_invalid");string id=Encode(Copy(att.credential,att.credentialSize,1,1024));
      return Obj("id",id,"rawId",id,"type","public-key","response",Obj("clientDataJSON",Encode(clientBytes),"attestationObject",Encode(Copy(att.obj,att.objectSize,1,65536))),"clientExtensionResults",Obj());
     }else{
      if(credentials==IntPtr.Zero)throw new NativeFailure("webauthn_invalid_request");var options=new GetOptions {version=4,timeout=timeout,verification=2,cancellation=cancellation,allow=credentials};
      if(op.CancelRequested)throw new NativeFailure("webauthn_cancelled");if(!WindowOwned(op))throw new NativeFailure("webauthn_changed");op.Invoked=true;Write(Obj("event","started","operationId",op.Id));
      hr=WebAuthNAuthenticatorGetAssertion(op.Window,rpId,ref client,ref options,out result);
      if(hr!=0)throw new NativeFailure(op.CancelRequested?"webauthn_cancelled":"webauthn_native_failed");if(result==IntPtr.Zero)throw new NativeFailure("webauthn_response_invalid");
      var att=(Assertion)Marshal.PtrToStructure(result,typeof(Assertion));if(att.version<1||att.credential.version!=1)throw new NativeFailure("webauthn_response_invalid");string id=Encode(Copy(att.credential.data,att.credential.size,1,1024));
      return Obj("id",id,"rawId",id,"type","public-key","response",Obj("clientDataJSON",Encode(clientBytes),"authenticatorData",Encode(Copy(att.auth,att.authSize,37,16384)),"signature",Encode(Copy(att.signature,att.signatureSize,1,16384)),"userHandle",att.userSize==0?null:Encode(Copy(att.user,att.userSize,1,64))),"clientExtensionResults",Obj());
     }
    }finally{op.Finished=true;if(result!=IntPtr.Zero){if(op.Kind=="create")WebAuthNFreeCredentialAttestation(result);else WebAuthNFreeAssertion(result);}}
   }
  }
 }
 static void RunOperation(Operation op){
  Dictionary<string,object> frame;
  try{frame=Obj("event","result","operationId",op.Id,"result",Ceremony(op));}
  catch(NativeFailure e){frame=Obj("event","error","operationId",op.Id,"code",e.Code,"nativeInvoked",op.Invoked);}
  catch{frame=Obj("event","error","operationId",op.Id,"code","webauthn_native_failed","nativeInvoked",op.Invoked);}
  finally{op.Finished=true;}
  lock(gate){if(active==op)active=null;Write(frame);op.Done.Set();}
 }
 static void Stop(){Operation op;lock(gate){shuttingDown=true;op=active;}if(op!=null){RequestCancel(op);op.Done.WaitOne(4000);}}
 public static void Run(){
  try{
   var init=Map(Serializer().DeserializeObject(ReadLine()));Exact(init,"op","protocol","nonce");nonce=Text(init,"nonce",32);if(Text(init,"op",8)!="init"||Number(init,"protocol",1,1)!=1||nonce.Length!=32)throw new NativeFailure("webauthn_invalid_request");foreach(char c in nonce)if(!Uri.IsHexDigit(c))throw new NativeFailure("webauthn_invalid_request");
   Write(Obj("event","ready","pid",Process.GetCurrentProcess().Id,"availability",Availability()));
   for(;;){string line=ReadLine();if(line==null)break;var m=Map(Serializer().DeserializeObject(line));if(Text(m,"nonce",32)!=nonce)throw new NativeFailure("webauthn_invalid_request");string kind=Text(m,"op",8);
    if(kind=="close"){Exact(m,"op","nonce");break;}
    if(kind=="cancel"){Exact(m,"op","nonce","operationId");string id=Text(m,"operationId",36);Operation op;lock(gate){op=active;}if(op!=null&&op.Id==id)RequestCancel(op);Write(Obj("event","cancelled","operationId",id));continue;}
    if(kind!="create"&&kind!="get")throw new NativeFailure("webauthn_invalid_request");
    if(kind=="create")Exact(m,"op","nonce","operationId","origin","rpId","parentHwnd","ownerPid","challenge","timeout","credentials","userId","algorithms");else Exact(m,"op","nonce","operationId","origin","rpId","parentHwnd","ownerPid","challenge","timeout","credentials");
    string operationId=Text(m,"operationId",36);Guid parsed;if(!Guid.TryParseExact(operationId,"D",out parsed))throw new NativeFailure("webauthn_invalid_request");
    lock(gate){if(active!=null||shuttingDown){Write(Obj("event","error","operationId",operationId,"code","webauthn_busy","nativeInvoked",false));continue;}Guid cancel;if(WebAuthNGetCancellationId(out cancel)!=0)throw new NativeFailure("webauthn_unavailable");var op=new Operation {Id=operationId,Kind=kind,Input=m,Cancellation=cancel};active=op;op.Thread=new Thread(delegate(){RunOperation(op);});op.Thread.IsBackground=true;op.Thread.Start();}
   }
  }catch{ /* Fixed parent protocol failure: no unbounded/raw diagnostics on stderr. */ }
  finally{Stop();}
 }
}
