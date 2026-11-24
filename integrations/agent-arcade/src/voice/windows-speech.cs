// Agent Arcade's fixed local Windows speech host. No user text is evaluated.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

public static class ArcadeVoiceHost {
  static readonly object OutputGate = new object();
  static SpeechRecognitionEngine recognizer;
  static SpeechSynthesizer speaker;
  static Timer audioTimer;
  static int listenEpoch;
  static int speakEpoch;
  static string listenId="";
  static void Emit(string id, string kind, object data=null) {
    lock(OutputGate) {
      var row=new Dictionary<string,object>{{"id",id},{"event",kind}};
      var fields=data as Dictionary<string,object>;
      if(fields!=null) foreach(var pair in fields) row[pair.Key]=pair.Value;
      Console.WriteLine(new JavaScriptSerializer().Serialize(row));
      Console.Out.Flush();
    }
  }
  static string Str(Dictionary<string,object> row,string key,string fallback="") {
    object value; return row.TryGetValue(key,out value) && value is string ? (string)value : fallback;
  }
  static void StopListening() {
    Interlocked.Increment(ref listenEpoch);
    listenId="";
    var oldTimer=audioTimer; audioTimer=null; if(oldTimer!=null) oldTimer.Dispose();
    var old=recognizer; recognizer=null;
    if(old!=null) {try{old.RecognizeAsyncCancel();}catch{} try{old.Dispose();}catch{}}
  }
  static void StopSpeaking() {
    Interlocked.Increment(ref speakEpoch);
    var old=speaker; speaker=null;
    if(old!=null) {try{old.SpeakAsyncCancelAll();}catch{} try{old.Dispose();}catch{}}
  }
  static void Capabilities(string id) {
    var recognizers=new List<object>();
    foreach(var item in SpeechRecognitionEngine.InstalledRecognizers()) recognizers.Add(new {id=item.Id,locale=item.Culture.Name,name=item.Name});
    var voices=new List<object>();
    using(var synth=new SpeechSynthesizer()) foreach(var item in synth.GetInstalledVoices()) if(item.Enabled) voices.Add(new {name=item.VoiceInfo.Name,locale=item.VoiceInfo.Culture.Name});
    Emit(id,"capabilities",new Dictionary<string,object>{{"recognizers",recognizers},{"voices",voices},{"backend","windows-system-speech"}});
  }
  static void Listen(Dictionary<string,object> row) {
    StopListening();
    var id=Str(row,"id"); var locale=Str(row,"locale","zh-CN");
    var engine=new SpeechRecognitionEngine(new CultureInfo(locale)); recognizer=engine; listenId=id;
    var epoch=Interlocked.Increment(ref listenEpoch);
    var levelGate=new object(); int currentLevel=0,maxLevel=0,levelCount=0;
    engine.AudioLevelUpdated+=(sender,e)=>{if(epoch!=listenEpoch)return;lock(levelGate){currentLevel=Math.Max(0,Math.Min(100,e.AudioLevel));maxLevel=Math.Max(maxLevel,currentLevel);levelCount=Math.Min(1000000,levelCount+1);}};
    engine.LoadGrammar(new DictationGrammar());
    engine.InitialSilenceTimeout=TimeSpan.Zero;
    engine.BabbleTimeout=TimeSpan.FromSeconds(20);
    engine.EndSilenceTimeout=TimeSpan.FromMilliseconds(650);
    engine.EndSilenceTimeoutAmbiguous=TimeSpan.FromMilliseconds(1000);
    engine.SpeechDetected+=(sender,e)=>{if(epoch==listenEpoch) Emit(id,"speech-start");};
    engine.SpeechRecognized+=(sender,e)=>{
      if(epoch!=listenEpoch||e.Result==null||String.IsNullOrWhiteSpace(e.Result.Text)) return;
      string text=e.Result.Text; if(text.Length>2000) text=text.Substring(0,2000);
      Emit(id,"transcript",new Dictionary<string,object>{{"text",text},{"confidence",e.Result.Confidence}});
    };
    engine.SpeechRecognitionRejected+=(sender,e)=>{if(epoch==listenEpoch) Emit(id,"unrecognized");};
    engine.RecognizeCompleted+=(sender,e)=>{if(epoch==listenEpoch) Emit(id,"listen-ended",new Dictionary<string,object>{{"cancelled",e.Cancelled},{"error",e.Error!=null}});};
    engine.SetInputToDefaultAudioDevice();
    engine.RecognizeAsync(RecognizeMode.Multiple);
    Emit(id,"listening",new Dictionary<string,object>{{"locale",locale}});
    audioTimer=new Timer(_=>{if(epoch!=listenEpoch)return;lock(levelGate){if(epoch==listenEpoch)Emit(id,"audio-level",new Dictionary<string,object>{{"current",currentLevel},{"max",maxLevel},{"count",levelCount}});}},null,1000,1000);
  }
  static void Speak(Dictionary<string,object> row) {
    StopSpeaking();
    var id=Str(row,"id"); var text=Str(row,"text");
    if(text.Length==0||text.Length>2000) throw new ArgumentException("invalid_text");
    var synth=new SpeechSynthesizer(); speaker=synth;
    var voice=Str(row,"voice"); var locale=Str(row,"locale","zh-CN");
    if(voice.Length>0) synth.SelectVoice(voice); else synth.SelectVoiceByHints(VoiceGender.NotSet,VoiceAge.NotSet,0,new CultureInfo(locale));
    synth.SetOutputToDefaultAudioDevice();
    var epoch=Interlocked.Increment(ref speakEpoch);
    synth.SpeakStarted+=(sender,e)=>{if(epoch==speakEpoch) Emit(id,"playback-start");};
    synth.SpeakCompleted+=(sender,e)=>{if(epoch==speakEpoch) Emit(id,"playback-end",new Dictionary<string,object>{{"cancelled",e.Cancelled},{"error",e.Error!=null}});};
    synth.SpeakAsync(text);
  }
  public static void Run() {
    Console.InputEncoding=new UTF8Encoding(false); Console.OutputEncoding=new UTF8Encoding(false);
    Emit("","ready");
    string line;
    while((line=Console.ReadLine())!=null) {
      string id="";
      try {
        if(line.Length>16000) throw new ArgumentException("oversized_command");
        var row=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(line);
        id=Str(row,"id"); if(id.Length>100) throw new ArgumentException("invalid_id");
        switch(Str(row,"op")) {
          case "capabilities": Capabilities(id); break;
          case "listen": Listen(row); break;
          case "finish-listening":
            if(recognizer!=null&&Str(row,"listenId")==listenId) recognizer.RecognizeAsyncStop();
            Emit(id,"finishing"); break;
          case "speak": Speak(row); break;
          case "stop-listening": StopListening(); Emit(id,"stopped"); break;
          case "stop-speaking": StopSpeaking(); Emit(id,"stopped"); break;
          case "interrupt": StopListening(); StopSpeaking(); Emit(id,"interrupted"); break;
          case "close": StopListening(); StopSpeaking(); Emit(id,"closed"); return;
          default: throw new ArgumentException("unknown_command");
        }
      } catch(Exception e) {
        // Do not forward stack traces, paths, device identifiers or spoken text.
        Emit(id,"error",new Dictionary<string,object>{{"code",e is CultureNotFoundException?"language_unavailable":e is PlatformNotSupportedException?"platform_unavailable":"speech_unavailable"}});
      }
    }
    StopListening(); StopSpeaking();
  }
}
