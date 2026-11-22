// bothouse Windows window shell: a frameless WinForms + WebView2 window that hosts
// the local bothouse web UI (channel + management panel) with native Windows
// caption buttons at the top-right.
//
// This file is a self-contained single source file; see README.md for build/run.
// C# 5 syntax only (built with the .NET Framework csc.exe shipped with Windows).

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace BothouseWindowShell
{
    internal static class Program
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool SetDllDirectory(string lpPathName);

        private static readonly string[] LibNames = new string[]
        {
            "Microsoft.Web.WebView2.Core.dll",
            "Microsoft.Web.WebView2.WinForms.dll",
            "WebView2Loader.dll",
        };

        // Only these two managed assemblies may be resolved from the bootstrap cache.
        private static readonly string[] ManagedLibNames = new string[]
        {
            "Microsoft.Web.WebView2.Core",
            "Microsoft.Web.WebView2.WinForms",
        };

        private static string _libDir;

        [STAThread]
        private static void Main()
        {
            try
            {
                _libDir = Bootstrap.LibraryDirectory();
                AppDomain.CurrentDomain.AssemblyResolve += ResolveFromLib;
                SetDllDirectory(_libDir);
                TrySetLoaderFolder(_libDir);

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Type formType = Type.GetType("BothouseWindowShell.ShellForm", true);
                Application.Run((Form)Activator.CreateInstance(formType));
            }
            catch (Exception ex)
            {
                try { File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "fatal.log"), ex.ToString()); } catch { }
            }
        }

        private static System.Reflection.Assembly ResolveFromLib(object sender, ResolveEventArgs args)
        {
            try
            {
                string name = new System.Reflection.AssemblyName(args.Name).Name;
                bool allowed = false;
                foreach (string expected in ManagedLibNames)
                    if (string.Equals(name, expected, StringComparison.Ordinal)) { allowed = true; break; }
                if (!allowed) return null;

                string path = Path.Combine(_libDir, name + ".dll");
                if (!File.Exists(path)) return null;
                return System.Reflection.Assembly.Load(File.ReadAllBytes(path));
            }
            catch (Exception ex)
            {
                DebugLog("resolve failed: " + ex.GetType().Name + " hr=" + ex.HResult);
                return null;
            }
        }

        private static void DebugLog(string message)
        {
            if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("BOTHOUSE_WINDOW_DEBUG"))) return;
            try
            {
                File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "bothouse-window.log"),
                    DateTime.Now.ToString("HH:mm:ss.fff") + " " + message + "\r\n");
            }
            catch { }
        }

        private static void TrySetLoaderFolder(string dir)
        {
            try
            {
                Type env = Type.GetType("Microsoft.Web.WebView2.Core.CoreWebView2Environment, Microsoft.Web.WebView2.Core");
                if (env == null) return;
                System.Reflection.MethodInfo mi = env.GetMethod("SetLoaderDllFolderPath");
                if (mi != null) mi.Invoke(null, new object[] { dir });
            }
            catch { }
        }
    }

    /// <summary>
    /// Extracts the embedded WebView2 DLLs (single-file build) or locates the DLLs
    /// copied next to the exe (dev build). Content-addressed directory + SHA256
    /// verification + temp-file-then-rename publication.
    /// </summary>
    internal static class Bootstrap
    {
        private static readonly string[] LibNames = new string[]
        {
            "Microsoft.Web.WebView2.Core.dll",
            "Microsoft.Web.WebView2.WinForms.dll",
            "WebView2Loader.dll",
        };

        public static string LibraryDirectory()
        {
            byte[][] embedded = new byte[LibNames.Length][];
            int present = 0;
            System.Reflection.Assembly asm = System.Reflection.Assembly.GetExecutingAssembly();
            for (int i = 0; i < LibNames.Length; i++)
            {
                using (Stream s = asm.GetManifestResourceStream(LibNames[i]))
                {
                    if (s == null) continue;
                    using (MemoryStream ms = new MemoryStream())
                    {
                        s.CopyTo(ms);
                        embedded[i] = ms.ToArray();
                        present++;
                    }
                }
            }

            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            if (present == 0)
            {
                // Development build: csc only; the three DLLs must sit next to the exe.
                foreach (string name in LibNames)
                {
                    if (!File.Exists(Path.Combine(exeDir, name)))
                        throw new IOException(
                            "Development build is missing " + name + " next to the exe. " +
                            "Run build.ps1 (which copies the WebView2 DLLs) or use -SingleFile.");
                }
                return exeDir;
            }
            if (present != LibNames.Length)
                throw new IOException("Corrupted build: only " + present + " of " + LibNames.Length +
                                      " WebView2 resources are embedded. Rebuild with build.ps1 -SingleFile.");

            string hash = ContentHash(embedded);
            string leaf = hash.Substring(0, 16);
            string root = TryPrepare(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "bothouse-window", "lib", leaf));
            if (root == null)
                root = TryPrepare(Path.Combine(Path.GetTempPath(), "bothouse-window", "lib", leaf));
            if (root == null)
                root = TryPrepare(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,
                    "bothouse-window-libs", leaf));
            if (root == null)
                throw new IOException(
                    "Cannot create a writable directory for the WebView2 DLLs. " +
                    "Run the exe from a writable folder (for example your user profile) and retry.");

            for (int i = 0; i < LibNames.Length; i++)
                Publish(Path.Combine(root, LibNames[i]), embedded[i], Sha256Hex(embedded[i]));
            return root;
        }

        private static string TryPrepare(string dir)
        {
            try
            {
                Directory.CreateDirectory(dir);
                string probe = Path.Combine(dir, ".write-test");
                File.WriteAllText(probe, "ok");
                File.Delete(probe);
                return dir;
            }
            catch { return null; }
        }

        private static void Publish(string path, byte[] bytes, string expectedHash)
        {
            if (File.Exists(path) && HashMatches(path, expectedHash)) return;

            string temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllBytes(temp, bytes);
                if (!HashMatches(temp, expectedHash))
                    throw new IOException("Checksum mismatch while writing " + Path.GetFileName(path));

                if (File.Exists(path))
                {
                    try
                    {
                        File.Replace(temp, path, null);
                    }
                    catch (IOException)
                    {
                        // Another process may have published the same content, or the file is locked.
                        if (HashMatches(path, expectedHash)) { TryDelete(temp); return; }
                        throw new IOException(
                            "Cannot update " + Path.GetFileName(path) +
                            " (it is locked by another instance?). Close all bothouse window instances and retry.");
                    }
                }
                else
                {
                    File.Move(temp, path);
                }
            }
            catch
            {
                TryDelete(temp);
                throw;
            }
        }

        private static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); } catch { }
        }

        private static bool HashMatches(string path, string expectedHash)
        {
            try { return string.Equals(Sha256Hex(File.ReadAllBytes(path)), expectedHash, StringComparison.OrdinalIgnoreCase); }
            catch { return false; }
        }

        private static string ContentHash(byte[][] blobs)
        {
            using (SHA256 sha = SHA256.Create())
            {
                for (int i = 0; i < blobs.Length; i++)
                {
                    byte[] name = Encoding.UTF8.GetBytes(LibNames[i]);
                    sha.TransformBlock(name, 0, name.Length, null, 0);
                    sha.TransformBlock(blobs[i], 0, blobs[i].Length, null, 0);
                }
                sha.TransformFinalBlock(new byte[0], 0, 0);
                return Hex(sha.Hash);
            }
        }

        private static string Sha256Hex(byte[] data)
        {
            using (SHA256 sha = SHA256.Create())
                return Hex(sha.ComputeHash(data));
        }

        private static string Hex(byte[] data)
        {
            StringBuilder sb = new StringBuilder(data.Length * 2);
            foreach (byte b in data) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }
    }

    internal sealed class ShellForm : Form
    {
        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int size);
        [DllImport("user32.dll")]
        private static extern bool ReleaseCapture();
        [DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

        private const int WM_NCLBUTTONDOWN = 0xA1;
        private const int HTCAPTION = 0x2;
        private const int WM_NCHITTEST = 0x0084;
        private const int HTLEFT = 10, HTRIGHT = 11, HTTOP = 12, HTTOPLEFT = 13, HTTOPRIGHT = 14;
        private const int HTBOTTOM = 15, HTBOTTOMLEFT = 16, HTBOTTOMRIGHT = 17;
        private const int VK_CONTROL = 0x11;
        private const int VK_TAB = 0x09, VK_W = 0x57, VK_R = 0x52, VK_F5 = 0x74;

        // Segoe MDL2 Assets glyphs (built into Windows 10/11).
        private const string GlyphMin = "\uE921";
        private const string GlyphMax = "\uE922";
        private const string GlyphRestore = "\uE923";
        private const string GlyphClose = "\uE8BB";

        private enum PagePhase { Idle, Loading, Ready, Failed, InitFailed }

        private sealed class PageState
        {
            public PagePhase Phase = PagePhase.Idle;
            public ulong NavigationId;
        }

        private readonly Color _chrome;
        private readonly Color _surface;
        private readonly Color _text;
        private readonly Color _secondary;
        private readonly Color _border;
        private readonly Color _accent;
        private readonly Color _softAccent;
        private readonly Color _success;
        private readonly Color _error;
        private readonly Color _hover;
        private static readonly Color CloseHover = Color.FromArgb(196, 43, 28);

        private readonly List<ToolTip> _toolTips = new List<ToolTip>();
        private readonly List<Font> _fonts = new List<Font>();

        private readonly WebView2 _channel = new WebView2();
        private readonly WebView2 _management = new WebView2();
        private readonly Panel _content = new Panel();
        private readonly Panel _errorPanel = new Panel();
        private readonly Label _errorTitle = new Label();
        private readonly Label _errorBody = new Label();
        private readonly Button _btnRetry = new Button();
        private readonly Button _btnAlt = new Button();
        private readonly Panel _statusBar = new Panel();
        private readonly Label _status = new Label();
        private readonly Label _origin = new Label();
        private readonly Label _brand = new Label();
        private readonly PictureBox _iconBox = new PictureBox();
        private readonly Panel _seg = new Panel();
        private readonly Button _tabChannel = new Button();
        private readonly Button _tabMgmt = new Button();
        private readonly Button _btnClose = new Button();
        private readonly Button _btnMin = new Button();
        private readonly Button _btnMax = new Button();
        private readonly Panel _titleBar = new Panel();

        private readonly PageState _channelState = new PageState();
        private readonly PageState _mgmtState = new PageState();

        private string _channelUrl = "http://127.0.0.1:8790/";
        private string _mgmtUrl = "http://127.0.0.1:9820/";
        private bool _showingChannel = true;
        private bool _closing;
        private bool _initializing;
        private bool _viewsReady;
        private bool _udfFallback;

        private int _barH, _captionW, _statusH, _resizeBorder;
        private int _iconSize, _tabH, _tabW, _segW;

        public ShellForm()
        {
            bool dark = IsDarkTheme();
            _chrome = dark ? Color.FromArgb(32, 34, 38) : Color.FromArgb(244, 245, 247);
            _surface = dark ? Color.FromArgb(24, 26, 30) : Color.White;
            _text = dark ? Color.FromArgb(240, 242, 245) : Color.FromArgb(32, 36, 43);
            _secondary = dark ? Color.FromArgb(168, 176, 189) : Color.FromArgb(96, 104, 116);
            _border = dark ? Color.FromArgb(54, 60, 70) : Color.FromArgb(223, 227, 232);
            _accent = dark ? Color.FromArgb(138, 180, 255) : Color.FromArgb(24, 90, 189);
            _softAccent = dark ? Color.FromArgb(39, 55, 80) : Color.FromArgb(234, 241, 252);
            _success = dark ? Color.FromArgb(139, 215, 166) : Color.FromArgb(35, 117, 68);
            _error = dark ? Color.FromArgb(255, 180, 171) : Color.FromArgb(180, 35, 24);
            _hover = dark ? Color.FromArgb(44, 48, 54) : Color.FromArgb(233, 235, 239);

            ApplyMetrics();

            Text = "bothouse";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(1320, 860);
            MinimumSize = new Size(960, 640);
            BackColor = _surface;
            DoubleBuffered = true;

            BuildTitleBar();
            BuildContent();
            BuildStatusBar();
            ApplyTheme();

            Shown += OnShownOnce;
            FormClosing += delegate { _closing = true; };

            Resize += delegate { LayoutAll(); };
            DpiChanged += delegate(object s, DpiChangedEventArgs e)
            {
                ApplyMetrics();
                LayoutAll();
            };
        }

        // ---------- metrics / DPI ----------
        private int Scale(int value)
        {
            return (int)Math.Round(value * DeviceDpi / 96.0);
        }

        private void ApplyMetrics()
        {
            _barH = Scale(40);
            _captionW = Scale(46);
            _statusH = Scale(28);
            _resizeBorder = Scale(6);
            _iconSize = Scale(16);
            _tabH = Scale(28);
            _tabW = Scale(88);
            _segW = Scale(188);
        }

        private static bool IsDarkTheme()
        {
            try
            {
                using (Microsoft.Win32.RegistryKey key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                {
                    object v = key == null ? null : key.GetValue("AppsUseLightTheme");
                    if (v is int) return (int)v == 0;
                }
            }
            catch { }
            return false;
        }

        private void ApplyDwm()
        {
            try
            {
                int pref = 2; // DWMWCP_ROUND (Windows 11; ignored on Windows 10)
                DwmSetWindowAttribute(Handle, 33, ref pref, sizeof(int));
                int dark = _surface.GetBrightness() < 0.5f ? 1 : 0;
                DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int));
            }
            catch { }
        }

        private void ApplyTheme()
        {
            BackColor = _surface;
            _titleBar.BackColor = _chrome;
            _seg.BackColor = _chrome;
            _statusBar.BackColor = _chrome;
            _errorPanel.BackColor = _surface;
            _brand.ForeColor = _text;
            _status.ForeColor = _secondary;
            _origin.ForeColor = _secondary;
            _errorTitle.ForeColor = _text;
            _errorBody.ForeColor = _secondary;
            _btnClose.BackColor = _chrome;
            _btnMin.BackColor = _chrome;
            _btnMax.BackColor = _chrome;
            _btnClose.ForeColor = _text;
            _btnMin.ForeColor = _text;
            _btnMax.ForeColor = _text;
            StyleTabButton(_tabChannel);
            StyleTabButton(_tabMgmt);
            StyleRetryButtons();
            UpdateMaximizeGlyph();
            Invalidate(true);
        }

        // ---------- title bar ----------
        private void BuildTitleBar()
        {
            _titleBar.Dock = DockStyle.Top;
            _titleBar.BackColor = _chrome;
            _titleBar.Paint += delegate(object s, PaintEventArgs e)
            {
                using (Pen pen = new Pen(_border))
                    e.Graphics.DrawLine(pen, 0, _titleBar.Height - 1, _titleBar.Width, _titleBar.Height - 1);
            };
            _titleBar.MouseDown += DragWindow;

            _iconBox.SizeMode = PictureBoxSizeMode.Zoom;
            _iconBox.BackColor = Color.Transparent;
            try
            {
                Icon appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (appIcon != null) _iconBox.Image = appIcon.ToBitmap();
            }
            catch { }
            _iconBox.MouseDown += DragWindow;

            _brand.Text = "bothouse";
            _brand.Font = TrackFont(new Font("Segoe UI", 10f, FontStyle.Regular));
            _brand.ForeColor = _text;
            _brand.AutoSize = true;
            _brand.BackColor = Color.Transparent;
            _brand.MouseDown += DragWindow;

            _seg.BackColor = _chrome;
            _seg.Paint += delegate(object s, PaintEventArgs e)
            {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                Rectangle r = new Rectangle(0, 0, _seg.Width - 1, _seg.Height - 1);
                using (GraphicsPath path = RoundRect(r, Scale(6)))
                using (SolidBrush brush = new SolidBrush(_chrome))
                    e.Graphics.FillPath(brush, path);
            };

            StyleTabButton(_tabChannel);
            StyleTabButton(_tabMgmt);
            _tabChannel.Text = "频道";
            _tabMgmt.Text = "管理面板";
            _tabChannel.Click += delegate { ShowTab(true); };
            _tabMgmt.Click += delegate { ShowTab(false); };
            _seg.Controls.Add(_tabChannel);
            _seg.Controls.Add(_tabMgmt);

            MakeCaptionButton(_btnMin, GlyphMin, false, "最小化");
            MakeCaptionButton(_btnMax, GlyphMax, false, "最大化");
            MakeCaptionButton(_btnClose, GlyphClose, true, "关闭");
            _btnMin.Click += delegate { WindowState = FormWindowState.Minimized; };
            _btnMax.Click += delegate { ToggleMaximize(); };
            _btnClose.Click += delegate { Close(); };

            _titleBar.Controls.Add(_iconBox);
            _titleBar.Controls.Add(_brand);
            _titleBar.Controls.Add(_seg);
            _titleBar.Controls.Add(_btnMin);
            _titleBar.Controls.Add(_btnMax);
            _titleBar.Controls.Add(_btnClose);
            Controls.Add(_titleBar);
        }

        private Font TrackFont(Font font)
        {
            _fonts.Add(font);
            return font;
        }

        private void MakeCaptionButton(Button b, string glyph, bool isClose, string tip)
        {
            b.Text = glyph;
            b.Font = TrackFont(new Font("Segoe MDL2 Assets", 10f));
            b.FlatStyle = FlatStyle.Flat;
            b.FlatAppearance.BorderSize = 0;
            b.BackColor = _chrome;
            b.ForeColor = _text;
            b.TabStop = false;
            b.Cursor = Cursors.Hand;
            b.AccessibleName = tip;
            ToolTip tt = new ToolTip();
            tt.SetToolTip(b, tip);
            _toolTips.Add(tt);
            b.MouseEnter += delegate
            {
                b.BackColor = isClose ? CloseHover : _hover;
                b.ForeColor = isClose ? Color.White : _text;
            };
            b.MouseLeave += delegate
            {
                b.BackColor = _chrome;
                b.ForeColor = _text;
            };
        }

        private void StyleTabButton(Button b)
        {
            b.FlatStyle = FlatStyle.Flat;
            b.FlatAppearance.BorderSize = 0;
            b.Font = TrackFont(new Font("Segoe UI", 9f, FontStyle.Regular));
            b.Cursor = Cursors.Hand;
            b.Height = _tabH;
            b.Width = _tabW;
            b.TabStop = true;
            b.Paint += delegate(object s, PaintEventArgs e)
            {
                bool active = (b == _tabChannel && _showingChannel) || (b == _tabMgmt && !_showingChannel);
                if (!active) return;
                using (Pen pen = new Pen(_accent, Math.Max(2, Scale(2))))
                    e.Graphics.DrawLine(pen, 0, b.Height - 1, b.Width, b.Height - 1);
            };
        }

        private void UpdateTabVisuals()
        {
            Button[] tabs = new Button[] { _tabChannel, _tabMgmt };
            bool[] active = new bool[] { _showingChannel, !_showingChannel };
            for (int i = 0; i < tabs.Length; i++)
            {
                Button b = tabs[i];
                bool on = active[i];
                b.BackColor = on ? _softAccent : _chrome;
                b.ForeColor = on ? _accent : _secondary;
                b.AccessibleName = on ? b.Text + "（当前页面）" : b.Text;
                b.Invalidate();
            }
        }

        private void UpdateMaximizeGlyph()
        {
            bool maximized = WindowState == FormWindowState.Maximized;
            _btnMax.Text = maximized ? GlyphRestore : GlyphMax;
            _btnMax.AccessibleName = maximized ? "还原" : "最大化";
            _btnMax.Invalidate();
        }

        private void LayoutBars()
        {
            _titleBar.Height = _barH;
            _iconBox.Size = new Size(_iconSize, _iconSize);
            _iconBox.Location = new Point(Scale(12), (_barH - _iconSize) / 2);
            _brand.Location = new Point(Scale(12) + _iconSize + Scale(8), (_barH - _brand.Height) / 2);

            int right = Width;
            _btnClose.Size = new Size(_captionW, _barH);
            _btnMax.Size = new Size(_captionW, _barH);
            _btnMin.Size = new Size(_captionW, _barH);
            _btnClose.Location = new Point(right - _captionW, 0);
            _btnMax.Location = new Point(right - _captionW * 2, 0);
            _btnMin.Location = new Point(right - _captionW * 3, 0);

            _seg.Size = new Size(_segW, _tabH + Scale(6));
            _seg.Left = Math.Max(_brand.Right + Scale(24), (Width - _seg.Width) / 2);
            _seg.Top = (_barH - _seg.Height) / 2;
            _tabChannel.SetBounds(Scale(2), Scale(3), _tabW, _tabH);
            _tabMgmt.SetBounds(Scale(2) + _tabW, Scale(3), _tabW, _tabH);
        }

        private void LayoutStatusBar()
        {
            _statusBar.Height = _statusH;
            _status.Location = new Point(Scale(14), (_statusH - _status.Height) / 2);
            int originLeft = _statusBar.Width - _origin.PreferredWidth - Scale(14);
            originLeft = Math.Max(_status.Right + Scale(16), originLeft);
            _origin.Location = new Point(originLeft, (_statusH - _origin.Height) / 2);
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            LayoutAll();
            UpdateMaximizeGlyph();
        }

        private void LayoutAll()
        {
            if (_titleBar.Height == 0) return;
            LayoutBars();
            LayoutStatusBar();
            LayoutErrorPanel();
        }

        protected override void WndProc(ref Message m)
        {
            base.WndProc(ref m);
            if (m.Msg != WM_NCHITTEST || m.Result.ToInt32() != 1) return;
            if (WindowState != FormWindowState.Normal) return;

            Point p = PointToClient(SignedPoint(m.LParam));
            int edge = _resizeBorder;
            bool left = p.X < edge, right = p.X > ClientSize.Width - edge;
            bool top = p.Y < edge, bottom = p.Y > ClientSize.Height - edge;
            if (!left && !right && !top && !bottom) return;

            if (top && left) m.Result = (IntPtr)HTTOPLEFT;
            else if (top && right) m.Result = (IntPtr)HTTOPRIGHT;
            else if (bottom && left) m.Result = (IntPtr)HTBOTTOMLEFT;
            else if (bottom && right) m.Result = (IntPtr)HTBOTTOMRIGHT;
            else if (left) m.Result = (IntPtr)HTLEFT;
            else if (right) m.Result = (IntPtr)HTRIGHT;
            else if (top) m.Result = (IntPtr)HTTOP;
            else m.Result = (IntPtr)HTBOTTOM;
        }

        // Signed 16-bit extraction is required: & 0xFFFF turns -10 into 65526.
        private static Point SignedPoint(IntPtr lParam)
        {
            long bits = lParam.ToInt64();
            return new Point(
                unchecked((short)(bits & 0xFFFF)),
                unchecked((short)((bits >> 16) & 0xFFFF)));
        }

        // ---------- content: webviews + error overlay ----------
        private void BuildContent()
        {
            _content.Dock = DockStyle.Fill;
            _content.BackColor = _surface;
            _channel.Dock = DockStyle.Fill;
            _management.Dock = DockStyle.Fill;
            _content.Controls.Add(_channel);
            _content.Controls.Add(_management);

            _errorPanel.Dock = DockStyle.Fill;
            _errorPanel.BackColor = _surface;
            _errorPanel.Visible = false;
            _errorTitle.AutoSize = false;
            _errorTitle.TextAlign = ContentAlignment.MiddleLeft;
            _errorTitle.Font = TrackFont(new Font("Segoe UI", 14f, FontStyle.Bold));
            _errorTitle.ForeColor = _text;
            _errorBody.AutoSize = false;
            _errorBody.TextAlign = ContentAlignment.TopLeft;
            _errorBody.Font = TrackFont(new Font("Segoe UI", 9.5f, FontStyle.Regular));
            _errorBody.ForeColor = _secondary;
            _btnRetry.FlatStyle = FlatStyle.Flat;
            _btnRetry.FlatAppearance.BorderSize = 0;
            _btnRetry.Font = TrackFont(new Font("Segoe UI", 9f, FontStyle.Regular));
            _btnRetry.Cursor = Cursors.Hand;
            _btnRetry.Click += delegate { RetryCurrent(); };
            _btnAlt.FlatStyle = FlatStyle.Flat;
            _btnAlt.Font = TrackFont(new Font("Segoe UI", 9f, FontStyle.Regular));
            _btnAlt.Cursor = Cursors.Hand;
            _btnAlt.Click += delegate
            {
                if (_showingChannel) ShowTab(false);
                else ShowTab(true);
            };
            _errorPanel.Controls.Add(_errorTitle);
            _errorPanel.Controls.Add(_errorBody);
            _errorPanel.Controls.Add(_btnRetry);
            _errorPanel.Controls.Add(_btnAlt);
            _content.Controls.Add(_errorPanel);
            Controls.Add(_content);
            _content.BringToFront();
        }

        private void StyleRetryButtons()
        {
            _btnRetry.BackColor = _accent;
            _btnRetry.ForeColor = _surface.GetBrightness() < 0.5f ? Color.FromArgb(20, 22, 26) : Color.White;
            _btnAlt.BackColor = _surface;
            _btnAlt.ForeColor = _text;
            _btnAlt.FlatAppearance.BorderColor = _border;
            _btnAlt.FlatAppearance.BorderSize = 1;
        }

        private void LayoutErrorPanel()
        {
            if (_errorPanel == null || _errorPanel.ClientSize.Width == 0) return;
            int width = Math.Min(Scale(450), _errorPanel.ClientSize.Width - Scale(48));
            int left = (_errorPanel.ClientSize.Width - width) / 2;
            int top = Math.Max(Scale(64), (_errorPanel.ClientSize.Height - Scale(210)) / 2);
            _errorTitle.SetBounds(left, top, width, Scale(34));
            _errorBody.SetBounds(left, top + Scale(42), width, Scale(62));
            _btnRetry.SetBounds(left, top + Scale(116), Scale(112), Scale(34));
            _btnAlt.SetBounds(left + Scale(124), top + Scale(116), Scale(132), Scale(34));
        }

        private void BuildStatusBar()
        {
            _statusBar.Dock = DockStyle.Bottom;
            _statusBar.BackColor = _chrome;
            _statusBar.Paint += delegate(object s, PaintEventArgs e)
            {
                using (Pen pen = new Pen(_border))
                    e.Graphics.DrawLine(pen, 0, 0, _statusBar.Width, 0);
            };
            _status.AutoSize = true;
            _status.Font = TrackFont(new Font("Segoe UI", 9f, FontStyle.Regular));
            _status.ForeColor = _secondary;
            _status.BackColor = Color.Transparent;
            _origin.AutoSize = true;
            _origin.Font = TrackFont(new Font("Segoe UI", 8.5f, FontStyle.Regular));
            _origin.ForeColor = _secondary;
            _origin.BackColor = Color.Transparent;
            _statusBar.Controls.Add(_status);
            _statusBar.Controls.Add(_origin);
            Controls.Add(_statusBar);
        }

        // ---------- window behavior ----------
        private void DragWindow(object sender, MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left) return;
            if (e.Clicks == 2) { ToggleMaximize(); return; }
            ReleaseCapture();
            SendMessage(Handle, WM_NCLBUTTONDOWN, (IntPtr)HTCAPTION, IntPtr.Zero);
        }

        private void ToggleMaximize()
        {
            WindowState = WindowState == FormWindowState.Maximized
                ? FormWindowState.Normal
                : FormWindowState.Maximized;
        }

        private void ShowTab(bool channel)
        {
            _showingChannel = channel;
            Log("tab -> " + (channel ? "channel" : "management"));
            UpdateChrome();
        }

        private void UpdateChrome()
        {
            PageState state = _showingChannel ? _channelState : _mgmtState;
            string pageName = _showingChannel ? "频道" : "管理面板";
            string phase;
            Color color;
            switch (state.Phase)
            {
                case PagePhase.Loading: phase = "正在加载"; color = _secondary; break;
                case PagePhase.Ready: phase = "页面已加载"; color = _success; break;
                case PagePhase.Failed: phase = "加载失败"; color = _error; break;
                case PagePhase.InitFailed: phase = "初始化失败"; color = _error; break;
                default: phase = "未开始"; color = _secondary; break;
            }
            _status.Text = pageName + " · " + phase;
            _status.ForeColor = color;

            string url = _showingChannel ? _channelUrl : _mgmtUrl;
            _origin.Text = SafeOrigin(url);
            _status.PerformLayout();
            _origin.PerformLayout();
            LayoutStatusBar();

            bool failed = state.Phase == PagePhase.Failed || state.Phase == PagePhase.InitFailed;
            _errorPanel.Visible = failed;
            if (failed)
            {
                bool init = state.Phase == PagePhase.InitFailed;
                _errorTitle.Text = init ? "浏览器组件初始化失败" : pageName + "暂时无法打开";
                _errorBody.Text = init
                    ? "WebView2 初始化没有完成。请确认已安装 WebView2 Runtime，然后重试。"
                    : "确认 bothouse 已启动，然后重试。";
                _btnRetry.Text = init ? "重试初始化" : "重新连接";
                _btnAlt.Text = _showingChannel ? "打开管理面板" : "返回频道";
                _btnRetry.Enabled = !_initializing;
                _errorPanel.BringToFront();
            }
            else
            {
                _btnRetry.Enabled = true;
            }

            _channel.Visible = _showingChannel && !failed;
            _management.Visible = !_showingChannel && !failed;
            UpdateTabVisuals();
            LayoutErrorPanel();
        }

        private void RetryCurrent()
        {
            if (_closing || IsDisposed) return;
            PageState state = _showingChannel ? _channelState : _mgmtState;
            WebView2 view = _showingChannel ? _channel : _management;
            string url = _showingChannel ? _channelUrl : _mgmtUrl;

            if (state.Phase == PagePhase.InitFailed || !_viewsReady)
            {
                BeginInitialize();
                return;
            }
            if (view.CoreWebView2 == null) return;
            Log("retry " + (_showingChannel ? "channel" : "management"));
            state.Phase = PagePhase.Loading;
            state.NavigationId = 0;
            UpdateChrome();
            view.CoreWebView2.Navigate(url);
        }

        // ---------- lifecycle / initialization ----------
        private bool IsClosedOrDisposed()
        {
            return _closing || IsDisposed || Disposing;
        }

        private void OnShownOnce(object sender, EventArgs e)
        {
            Shown -= OnShownOnce;
            ApplyDwm();
            BeginInitialize();
        }

        private async void BeginInitialize()
        {
            if (_initializing) return;
            _initializing = true;
            try
            {
                await InitializeViewsAsync();
            }
            catch (Exception ex)
            {
                if (IsClosedOrDisposed()) return;
                FailInitialization(ex);
            }
            finally
            {
                _initializing = false;
                if (!IsClosedOrDisposed()) UpdateChrome();
            }
        }

        private async Task InitializeViewsAsync()
        {
            _channelState.Phase = PagePhase.Loading;
            _mgmtState.Phase = PagePhase.Loading;
            UpdateChrome();

            CoreWebView2Environment env;
            try
            {
                env = await CreateEnvironmentAsync();
            }
            catch (WebView2RuntimeNotFoundException ex)
            {
                if (IsClosedOrDisposed()) return;
                Log("webview2 runtime missing hr=" + ex.HResult);
                ShowRuntimeMissing();
                return;
            }

            if (_udfFallback) Log("using default WebView2 user data folder (custom UDF unavailable)");

            if (IsClosedOrDisposed()) return;
            await _channel.EnsureCoreWebView2Async(env);
            if (IsClosedOrDisposed()) return;
            await _management.EnsureCoreWebView2Async(env);
            if (IsClosedOrDisposed()) return;

            await ConfigureViewAsync(_channel, true);
            if (IsClosedOrDisposed()) return;
            await ConfigureViewAsync(_management, false);
            if (IsClosedOrDisposed()) return;
            _viewsReady = true;

            _channelUrl = ReadChannelUrl();
            _mgmtUrl = ReadManagementUrl();
            _channelState.Phase = PagePhase.Loading;
            _mgmtState.Phase = PagePhase.Loading;
            UpdateChrome();

            _channel.CoreWebView2.Navigate(_channelUrl);
            _management.CoreWebView2.Navigate(_mgmtUrl);
            Log("navigated channel=" + SafeOrigin(_channelUrl) + " management=" + SafeOrigin(_mgmtUrl));
        }

        private async Task<CoreWebView2Environment> CreateEnvironmentAsync()
        {
            string userDataDir = FindWritableUserDataFolder();
            if (userDataDir != null)
            {
                try
                {
                    CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userDataDir);
                    Log("user data folder: " + userDataDir);
                    return env;
                }
                catch (Exception ex)
                {
                    // Some Windows 10 machines fail with E_UNEXPECTED for a custom UDF.
                    Log("custom user data folder failed: " + ex.GetType().Name + " hr=" + ex.HResult);
                }
            }
            _udfFallback = true;
            Log("falling back to the default WebView2 user data folder (next to the exe)");
            return await CoreWebView2Environment.CreateAsync();
        }

        // Try LocalAppData, then TEMP, then the exe directory. Returns null when none
        // is writable; WebView2 then uses its default folder next to the exe.
        private string FindWritableUserDataFolder()
        {
            string[] candidates = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "bothouse-window", "webview2-data"),
                Path.Combine(Path.GetTempPath(), "bothouse-window", "webview2-data"),
                Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "webview2-data"),
            };
            foreach (string dir in candidates)
            {
                try
                {
                    Directory.CreateDirectory(dir);
                    string probe = Path.Combine(dir, ".write-test");
                    File.WriteAllText(probe, "ok");
                    File.Delete(probe);
                    return dir;
                }
                catch (Exception ex)
                {
                    Log("user data candidate rejected: " + dir + " (" + ex.GetType().Name + ")");
                }
            }
            return null;
        }

        private async Task ConfigureViewAsync(WebView2 view, bool isChannel)
        {
            CoreWebView2 core = view.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsWebMessageEnabled = true;
            // Let the page see Ctrl+Tab / Ctrl+W / Ctrl+R / F5; otherwise WebView2
            // consumes them as browser accelerators and the shell never receives them.
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.NewWindowRequested += OnNewWindow;
            core.WebMessageReceived += delegate(object s, CoreWebView2WebMessageReceivedEventArgs e)
            {
                OnWebMessage(isChannel, e);
            };
            core.NavigationStarting += delegate(object s, CoreWebView2NavigationStartingEventArgs e)
            {
                OnNavigationStarting(isChannel, e);
            };
            core.NavigationCompleted += delegate(object s, CoreWebView2NavigationCompletedEventArgs e)
            {
                OnNavigationCompleted(isChannel, e);
            };
            await core.AddScriptToExecuteOnDocumentCreatedAsync(ShortcutScript);
        }

        private void OnNewWindow(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
        }

        private void OnNavigationStarting(bool isChannel, CoreWebView2NavigationStartingEventArgs e)
        {
            PageState state = isChannel ? _channelState : _mgmtState;
            state.Phase = PagePhase.Loading;
            state.NavigationId = e.NavigationId;
            if (isChannel == _showingChannel) UpdateChrome();
        }

        private void OnNavigationCompleted(bool isChannel, CoreWebView2NavigationCompletedEventArgs e)
        {
            PageState state = isChannel ? _channelState : _mgmtState;
            if (state.Phase != PagePhase.Loading || state.NavigationId != e.NavigationId) return;

            state.Phase = e.IsSuccess ? PagePhase.Ready : PagePhase.Failed;
            Log("nav " + (isChannel ? "channel" : "management") + " success=" + e.IsSuccess + " navId=" + e.NavigationId);
            if (isChannel == _showingChannel) UpdateChrome();


        }

        // Shell shortcuts must work while a WebView2 has keyboard focus. WebView2
        // input is handled by the browser process, so the page forwards the few
        // shell shortcuts through window.chrome.webview.postMessage(); the host
        // only accepts messages from the configured channel/management origins.
        private const string ShortcutScript =
            "(function(){if(window.__bothouseShellKeys)return;window.__bothouseShellKeys=true;" +
            "document.addEventListener('keydown',function(e){" +
            "if(e.defaultPrevented)return;" +
            "if(e.ctrlKey&&!e.shiftKey&&!e.altKey&&!e.metaKey){" +
            " if(e.key==='Tab'){e.preventDefault();e.stopPropagation();window.chrome.webview.postMessage('shell:tab');return;}" +
            " if(e.key==='w'||e.key==='W'){e.preventDefault();e.stopPropagation();window.chrome.webview.postMessage('shell:close');return;}" +
            " if(e.key==='r'||e.key==='R'){e.preventDefault();e.stopPropagation();window.chrome.webview.postMessage('shell:reload');return;}" +
            "}" +
            "if(e.key==='F5'){e.preventDefault();e.stopPropagation();window.chrome.webview.postMessage('shell:reload');}" +
            "},true);})();";

        private void OnWebMessage(bool isChannel, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string message;
            try { message = e.TryGetWebMessageAsString(); }
            catch { return; }
            if (message == null) return;
            if (message != "shell:tab" && message != "shell:close" && message != "shell:reload") return;

            // Authorization uses parsed URIs, not display strings: invalid or
            // credential-bearing URLs must never compare equal to each other.
            Uri source;
            Uri configured;
            bool sourceOk = TryParseOrigin(e.Source, out source);
            bool configOk = TryParseOrigin(isChannel ? _channelUrl : _mgmtUrl, out configured);
            if (!sourceOk || !configOk || !SameOrigin(source, configured))
            {
                Log("web message rejected: origin mismatch");
                return;
            }

            if (message == "shell:tab")
                BeginInvoke(new Action(delegate { ShowTab(!_showingChannel); }));
            else if (message == "shell:close")
                BeginInvoke(new Action(Close));
            else if (message == "shell:reload")
                BeginInvoke(new Action(RetryCurrent));
        }

        private void FailInitialization(Exception ex)
        {
            _channelState.Phase = PagePhase.InitFailed;
            _mgmtState.Phase = PagePhase.InitFailed;
            Log("initialization failed: " + ex.GetType().Name + " hr=" + ex.HResult);
            UpdateChrome();
        }

        private void ShowRuntimeMissing()
        {
            _channelState.Phase = PagePhase.InitFailed;
            _mgmtState.Phase = PagePhase.InitFailed;
            UpdateChrome();
            _errorTitle.Text = "无法启动浏览器组件";
            _errorBody.Text = "需要 Microsoft Edge WebView2 Runtime。请从微软官网下载安装后重试。";
            MessageBox.Show(
                "This window needs the Microsoft Edge WebView2 Runtime.\r\n\r\n" +
                "Download it from:\r\nhttps://developer.microsoft.com/microsoft-edge/webview2/\r\n\r\n" +
                "Windows 10/11 usually ships it already.",
                "bothouse - WebView2 Runtime missing",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }

        internal void Log(string message)
        {
            if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("BOTHOUSE_WINDOW_DEBUG"))) return;
            try
            {
                File.AppendAllText(
                    Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "bothouse-window.log"),
                    DateTime.Now.ToString("HH:mm:ss.fff") + " " + message + "\r\n");
            }
            catch { }
        }

        // ---------- URLs ----------
        private static string ReadChannelUrl()
        {
            string value = GetArgValue("--channel-url");
            if (!string.IsNullOrEmpty(value)) return value;
            value = Environment.GetEnvironmentVariable("BOTHOUSE_CHANNEL_URL");
            if (!string.IsNullOrEmpty(value)) return value;
            value = Environment.GetEnvironmentVariable("BOTHOUSE_HUB_JSON");
            if (!string.IsNullOrEmpty(value) && File.Exists(value)) return BuildChannelUrl(value);

            foreach (string hubJson in FindHubJsonCandidates())
                return BuildChannelUrl(hubJson);
            return "http://127.0.0.1:8790/";
        }

        private static string ReadManagementUrl()
        {
            string value = GetArgValue("--management-url");
            if (!string.IsNullOrEmpty(value)) return value;
            value = Environment.GetEnvironmentVariable("BOTHOUSE_MANAGEMENT_URL");
            if (!string.IsNullOrEmpty(value)) return value;
            return "http://127.0.0.1:9820/";
        }

        private static string GetArgValue(string name)
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i + 1 < args.Length; i++)
                if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase))
                    return args[i + 1];
            return null;
        }

        private static string[] FindHubJsonCandidates()
        {
            string[] relative = new string[]
            {
                Path.Combine("hub", "hub.json"),
                Path.Combine("tools", "bothouse-hub", "hub.json"),
                "hub.json",
            };
            List<string> hits = new List<string>();
            try
            {
                string home = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".bothouse");
                foreach (string rel in relative)
                {
                    string p = Path.Combine(home, rel);
                    if (File.Exists(p)) hits.Add(p);
                }
            }
            catch { }
            try
            {
                DirectoryInfo dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
                while (dir != null)
                {
                    foreach (string rel in relative)
                    {
                        string p = Path.Combine(dir.FullName, rel);
                        if (File.Exists(p) && !hits.Contains(p)) hits.Add(p);
                    }
                    dir = dir.Parent;
                }
            }
            catch { }
            return hits.ToArray();
        }

        private static string BuildChannelUrl(string hubJson)
        {
            try
            {
                string text = File.ReadAllText(hubJson);
                Match token = Regex.Match(text, "\"web_token\"\\s*:\\s*\"([^\"]+)\"");
                Match portMatch = Regex.Match(text, "\"port\"\\s*:\\s*(\\d+)");
                int port = portMatch.Success ? int.Parse(portMatch.Groups[1].Value) : 8790;
                string url = "http://127.0.0.1:" + port + "/";
                if (token.Success) url += "#token=" + Uri.EscapeDataString(token.Groups[1].Value);
                return url;
            }
            catch { }
            return "http://127.0.0.1:8790/";
        }

        private static bool TryParseOrigin(string raw, out Uri uri)
        {
            uri = null;
            Uri candidate;
            if (!Uri.TryCreate(raw, UriKind.Absolute, out candidate)) return false;
            if (candidate.Scheme != Uri.UriSchemeHttp && candidate.Scheme != Uri.UriSchemeHttps) return false;
            if (string.IsNullOrEmpty(candidate.Host) || !string.IsNullOrEmpty(candidate.UserInfo)) return false;
            uri = candidate;
            return true;
        }

        private static bool SameOrigin(Uri a, Uri b)
        {
            return string.Equals(a.Scheme, b.Scheme, StringComparison.OrdinalIgnoreCase)
                && string.Equals(a.IdnHost, b.IdnHost, StringComparison.OrdinalIgnoreCase)
                && a.Port == b.Port;
        }

        // Status bar / logs only ever show scheme://host:port.
        private static string SafeOrigin(string raw)
        {
            try
            {
                Uri uri;
                if (!Uri.TryCreate(raw, UriKind.Absolute, out uri)) return "[invalid url]";
                if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return "[unsupported url]";
                if (string.IsNullOrEmpty(uri.Host) || !string.IsNullOrEmpty(uri.UserInfo)) return "[invalid url]";
                return uri.GetLeftPart(UriPartial.Authority);
            }
            catch { return "[invalid url]"; }
        }

        private static GraphicsPath RoundRect(Rectangle r, int radius)
        {
            GraphicsPath path = new GraphicsPath();
            int d = radius * 2;
            if (d <= 0) { path.AddRectangle(r); return path; }
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                foreach (ToolTip tt in _toolTips) tt.Dispose();
                foreach (Font font in _fonts) font.Dispose();
                if (_iconBox.Image != null) _iconBox.Image.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}