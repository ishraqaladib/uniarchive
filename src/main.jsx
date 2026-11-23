import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  NavLink,
  Navigate,
  Outlet,
  useNavigate,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import {
  BookOpen,
  Menu,
  Moon,
  Sun,
  LayoutDashboard,
  ArrowUp,
  FileText,
  CreditCard,
  ChartNoAxesColumn,
  HelpCircle,
  User,
  Search,
  Upload,
  Library,
  LogOut,
  ShieldCheck,
  Settings,
  Bookmark,
  Plus,
  Download,
  Eye,
  Pencil,
  Trash2,
  X,
  Check,
  ArrowRight,
  FolderOpen,
  CheckCircle,
  Clock,
  ArrowLeft,
} from "lucide-react";
import "./base.css";
import "./styles.css";
async function api(url, options = {}) {
  const res = await fetch("/api" + url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "X-UniArchive-Client": "web",
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    if (
      res.status === 401 &&
      (!url.startsWith("/auth/") || url === "/auth/logout")
    )
      window.dispatchEvent(new Event("uniarchive-session-expired"));
    throw new Error(data.error || "Request failed.");
  }
  return data;
}
const Auth = createContext();
const useAuth = () => useContext(Auth);
function App() {
  const [user, setUser] = useState(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    api("/auth/me")
      .then((d) => setUser(d.user))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const expire = () => setUser(null);
    window.addEventListener("uniarchive-session-expired", expire);
    return () =>
      window.removeEventListener("uniarchive-session-expired", expire);
  }, []);
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
  };
  return (
    <Auth.Provider value={{ user, setUser, loading, logout }}>
      <BrowserRouter>
        <ScrollReset />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/signup" element={<AuthPage mode="signup" />} />
          <Route
            path="/privacy"
            element={
              <PublicPage>
                <PrivacyPage />
              </PublicPage>
            }
          />
          <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
          <Route path="/reset-password" element={<AuthPage mode="reset" />} />
          <Route path="/verify-email" element={<AuthPage mode="verify" />} />
          <Route
            path="/help"
            element={
              <PublicPage>
                <Help />
              </PublicPage>
            }
          />
          <Route
            path="/plans"
            element={
              <PublicPage>
                <Plans />
              </PublicPage>
            }
          />
          <Route
            path="/directory"
            element={
              <PublicPage>
                <LibraryPage publicView />
              </PublicPage>
            }
          />
          <Route
            path="/app"
            element={
              <Protected>
                <Shell />
              </Protected>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="courses/:id" element={<LibraryPage />} />
            <Route path="upload" element={<UploadPage />} />
            <Route path="uploads" element={<DocumentsPage mode="mine" />} />
            <Route path="saved" element={<DocumentsPage mode="saved" />} />
            <Route
              path="moderation"
              element={
                <RoleGate roles={["Admin", "Moderator"]}>
                  <DocumentsPage mode="queue" />
                </RoleGate>
              }
            />
            <Route
              path="courses"
              element={
                <RoleGate roles={["Admin"]}>
                  <CoursesAdmin />
                </RoleGate>
              }
            />
            <Route path="plans" element={<Plans />} />
            <Route path="billing" element={<Billing />} />
            <Route path="overview" element={<Overview />} />
            <Route path="help" element={<Help />} />
            <Route path="account" element={<Account />} />
            <Route
              path="settings"
              element={
                <RoleGate roles={["Admin"]}>
                  <SettingsPage />
                </RoleGate>
              }
            />
          </Route>
          <Route
            path="*"
            element={
              <PublicPage>
                <Empty
                  title="Page not found"
                  text="This page does not exist."
                />
                <Link className="button" to="/">
                  Back home
                </Link>
              </PublicPage>
            }
          />
        </Routes>
      </BrowserRouter>
    </Auth.Provider>
  );
}
function ScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  return user ? (
    children
  ) : (
    <Navigate
      to="/login"
      state={{ from: location.pathname + location.search }}
      replace
    />
  );
}
function RoleGate({ roles, children }) {
  const { user } = useAuth();
  return roles.includes(user.role) ? (
    children
  ) : (
    <Empty
      title="Access restricted"
      text="Your account does not have permission to use this page."
    />
  );
}
function useData(url, refresh = 0) {
  const [data, setData] = useState(null),
    [err, setErr] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    setErr("");
    api(url)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setErr(e.message);
      });
    return () => {
      active = false;
    };
  }, [url, refresh]);
  return { data, err };
}
function Brand() {
  return (
    <Link className="brand" to="/">
      <span className="logo">
        <BookOpen />
      </span>
      UniArchive
    </Link>
  );
}
function Theme() {
  const [dark, setDark] = useState(
    document.documentElement.dataset.theme === "dark",
  );
  return (
    <button
      className="theme-button"
      aria-label={`Switch to ${dark ? "light" : "dark"} mode`}
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.dataset.theme = next ? "dark" : "light";
        try {
          localStorage.setItem("uniarchive-theme", next ? "dark" : "light");
        } catch {}
      }}
    >
      {dark ? <Sun /> : <Moon />}
      <span>{dark ? "Light" : "Dark"}</span>
    </button>
  );
}
function PublicNav() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  return (
    <header>
      <div className="nav wrap">
        <button
          className="icon-button"
          aria-label="Toggle navigation"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Menu />
        </button>
        <Brand />
        <nav className="desktop-links">
          <Link to="/">Home</Link>
          <Link to="/plans">Plans</Link>
          <Link to="/help">Help</Link>
        </nav>
        <div className="nav-actions">
          <Theme />
          {user ? (
            <Link className="button primary small" to="/app">
              Dashboard
            </Link>
          ) : (
            <>
              <Link className="button small login-nav" to="/login">
                Login
              </Link>
              <Link className="button primary small" to="/signup">
                Sign Up
              </Link>
            </>
          )}
        </div>
      </div>
      {open && (
        <nav className="mobile-menu wrap" onClick={() => setOpen(false)}>
          <Link to="/">Home</Link>
          <Link to="/directory">Course directory</Link>
          <Link to="/plans">Plans</Link>
          <Link to="/help">Help</Link>
          <Link to="/login">Login</Link>
        </nav>
      )}
    </header>
  );
}
function PublicPage({ children }) {
  return (
    <>
      <PublicNav />
      <main className="wrap public-content">{children}</main>
      <Footer />
    </>
  );
}
function Footer() {
  return (
    <footer>
      <div className="wrap footer-content">
        <p>UniArchive: Academic Knowledge Repository · CSE 300 &amp; CSE 323</p>
        <nav>
          <Link to="/help">Help</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/plans">Plans</Link>
          <Link to="/login">Login</Link>
        </nav>
      </div>
    </footer>
  );
}
function PrivacyPage() {
  const { data: config } = useData("/config");
  return (
    <article
      className="panel"
      style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: "clamp(24px,5vw,48px)",
      }}
    >
      <h1>Privacy at UniArchive</h1>
      <p>
        UniArchive stores your name, email address, a password hash, account
        role and status, your optional profile picture, uploaded document
        details, review decisions, saved documents and download activity to
        operate this academic repository. Your plain-text password is not
        stored.
      </p>
      <h2>Who can see your work</h2>
      <p>
        Pending documents can be read by their uploader and repository
        reviewers. Approved documents can be read by signed-in members.
        Administrators manage accounts and repository records. Upload only
        material you are permitted to share and avoid including confidential
        personal information in academic files.
      </p>
      <h2>Cloud storage and service providers</h2>
      <p>
        The hosted application uses Vercel to serve the website and API, TiDB
        Cloud for account and repository records, and the operator’s Google
        Drive for PDF storage. Upload chunks are staged temporarily in the
        database while the PDF is checked and saved to Drive. The configured
        email service receives your email address and account verification or
        password reset message. These providers process the information needed
        to deliver their services.
      </p>
      <p>
        Google Drive access is held by the server using an operator-authorized
        connection. The application requests the drive.file permission for
        app-created or explicitly selected files. Members do not need to connect
        their own Google accounts. Repository PDFs are served through
        UniArchive’s account access checks.
      </p>
      <h2>Cookies and retention</h2>
      <p>
        A secure, HttpOnly session cookie keeps you signed in for up to eight
        hours. Your theme preference is saved in your browser. This application
        does not add advertising or analytics trackers.
      </p>
      <p>
        Account and document records are retained while they are in use. You can
        delete your uploads and delete your account in Settings. File removal
        may wait for a successful storage cleanup retry. Incomplete upload
        sessions expire after an hour and their chunks are removed by
        maintenance or when a new upload starts. Infrastructure logs and backups
        may follow separate provider retention policies.
      </p>
      <h2>Questions and account requests</h2>
      <p>
        Use Help or contact the administrator who invited you to the repository
        for access, correction or deletion requests.
        {config?.supportEmail && (
          <>
            {" "}
            You can also email{" "}
            <a href={"mailto:" + config.supportEmail}>{config.supportEmail}</a>.
          </>
        )}
      </p>
    </article>
  );
}
function Landing() {
  const { data } = useData("/stats");
  return (
    <>
      <PublicNav />
      <main className="wrap">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">Academic Knowledge Repository</span>
            <h1>
              Every course. Every
              <br className="desktop-break" /> paper. One trusted
              <br className="desktop-break" /> archive.
            </h1>
            <p>
              Find notes, slides and past papers organised by department,
              semester and course code. Every file is reviewed before it goes
              public.
            </p>
            <div className="hero-actions">
              <Link className="button primary" to="/signup">
                Get started free
              </Link>
              <a className="button" href="#plans">
                View plans
              </a>
            </div>
          </div>
          <div className="course-preview">
            <div className="course-heading">
              <h2>CSE 323: Web Programming Lab</h2>
              <span>3 credits</span>
            </div>
            {[
              ["Lab 4: Express routing notes", "Note · 2026", "Approved"],
              ["Midterm past paper", "Past Paper · 2025", "Approved"],
              ["Chapter 3 slides", "Slide · 2026", "Pending"],
            ].map(([name, meta, status]) => (
              <div className="document" key={name}>
                <span className="pdf">PDF</span>
                <div>
                  <h3>{name}</h3>
                  <p>{meta}</p>
                </div>
                <span
                  className={
                    "status " + (status === "Pending" ? "pending" : "")
                  }
                >
                  {status}
                </span>
              </div>
            ))}
            <p className="sample-note">Example course preview</p>
          </div>
        </section>
        <section className="statistics" aria-label="Live repository statistics">
          {[
            ["documents", "Documents shared"],
            ["courses", "Courses listed"],
            ["students", "Student members"],
            ["downloads", "Downloads"],
          ].map(([key, label]) => (
            <div className="stat" key={key}>
              <Counter value={data?.[key] ?? 0} />
              <span>{label}</span>
            </div>
          ))}
        </section>
        <section className="section">
          <h2>How UniArchive works</h2>
          <p className="section-intro">
            Three steps from a scattered file to a trusted resource.
          </p>
          <div className="three-grid">
            {[
              [
                "Upload",
                "Add a PDF with its title, type, academic year and course.",
              ],
              [
                "Review",
                "Moderators approve or reject each submission from the pending queue.",
              ],
              [
                "Discover",
                "Search by course code, filter by year and type, then download.",
              ],
            ].map(([t, d], i) => (
              <article className="step" key={t}>
                <span className="step-number">0{i + 1}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="section plans" id="plans">
          <Plans compact />
        </section>
      </main>
      <Footer />
    </>
  );
}
function Counter({ value }) {
  const [n, setN] = useState(value);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(value);
      return;
    }
    const start = performance.now();
    let raf;
    function tick(t) {
      const p = Math.min((t - start) / 900, 1);
      setN(Math.round(value * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <strong>{n.toLocaleString()}</strong>;
}
function Loading() {
  return (
    <div className="loading" role="status">
      Loading your library…
    </div>
  );
}
function Alert({ children, success = false }) {
  return children ? (
    <div
      className={"alert " + (success ? "success" : "")}
      role={success ? "status" : "alert"}
    >
      {children}
    </div>
  ) : null;
}
function Empty({
  title = "Nothing here yet",
  text = "New resources will appear here when they are available.",
}) {
  return (
    <div className="empty">
      <FolderOpen />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Heading({ title, text, action }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {text && <p>{text}</p>}
      </div>
      {action}
    </div>
  );
}
function Field({ label, children, ...props }) {
  const id = props.id || props.name;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children ? (
        React.cloneElement(children, { id })
      ) : (
        <input {...props} id={id} />
      )}
    </div>
  );
}
function AuthPage({ mode }) {
  const { user, setUser } = useAuth(),
    navigate = useNavigate(),
    location = useLocation();
  const [params] = useSearchParams();
  const [err, setErr] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setErr("");
    setMessage("");
  }, [mode]);
  if (user && ["login", "signup"].includes(mode))
    return <Navigate to="/app" replace />;
  const titles = {
    login: "Welcome back",
    signup: "Create your account",
    forgot: "Forgot your password?",
    reset: "Choose a new password",
    verify: "Verify your email",
  };
  async function submit(e) {
    e.preventDefault();
    setErr("");
    setMessage("");
    setBusy(true);
    const b = Object.fromEntries(new FormData(e.currentTarget));
    if (mode === "reset" || mode === "verify")
      b.token = params.get("token") || "";
    try {
      const endpoint = {
        login: "login",
        signup: "register",
        forgot: "forgot-password",
        reset: "reset-password",
        verify: "verify-email",
      }[mode];
      const result = await api("/auth/" + endpoint, {
        method: "POST",
        body: JSON.stringify(b),
      });
      if (mode === "login") {
        setUser(result.user);
        const from = location.state?.from;
        navigate(from?.startsWith("/app") ? from : "/app", { replace: true });
      } else {
        setMessage(result.message);
        e.target.reset();
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={"auth-screen " + (mode === "login" ? "login-screen" : "")}>
      <aside className="auth-aside">
        <Brand />
        <div>
          <span className="eyebrow">Your academic advantage</span>
          <h1>
            {mode === "login"
              ? "Pick up where you left off."
              : "Join your university’s knowledge library."}
          </h1>
          <p>
            {mode === "login"
              ? "Your notes, uploads and saved courses are waiting."
              : "Sign up with any email address to upload, search and download reviewed course material."}
          </p>
        </div>
        <small>CSE 300 &amp; CSE 323 · Web Programming Lab &amp; Project</small>
      </aside>
      <main className="auth-main">
        <div className="auth-tools">
          <Link to="/" className="muted">
            <ArrowLeft size={16} /> Back home
          </Link>
          <Theme />
        </div>
        <div className="auth-card">
          <h1>{titles[mode]}</h1>
          <p>
            {mode === "signup"
              ? "It takes less than a minute."
              : mode === "login"
                ? "Log in to continue to your dashboard."
                : mode === "verify"
                  ? "Confirm ownership of your email address."
                  : "We will help you get back to your library."}
          </p>
          <Alert>{err}</Alert>
          <Alert success>{message}</Alert>
          <form onSubmit={submit}>
            {mode === "signup" && (
              <Field
                label="Full name"
                name="name"
                autoComplete="name"
                required
                maxLength={100}
              />
            )}
            {["signup", "login", "forgot"].includes(mode) && (
              <Field
                label="Email address"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            )}
            {["signup", "login", "reset"].includes(mode) && (
              <Field
                label="Password"
                name="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={mode === "login" ? 1 : 8}
                maxLength={72}
                required
              />
            )}
            {["signup", "reset"].includes(mode) && (
              <Field
                label="Confirm password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                required
              />
            )}
            {mode === "login" && (
              <Link className="forgot-link" to="/forgot-password">
                Forgot password?
              </Link>
            )}
            <button
              className="button primary full"
              disabled={
                busy || (!!message && ["verify", "reset"].includes(mode))
              }
            >
              {busy
                ? "Please wait…"
                : {
                    login: "Log in",
                    signup: "Create account",
                    forgot: "Send reset link",
                    reset: "Update password",
                    verify: "Verify email",
                  }[mode]}
            </button>
          </form>
          <p className="dialog-bottom">
            {mode === "signup" ? (
              <>
                Already have an account? <Link to="/login">Log in</Link>
              </>
            ) : mode === "login" ? (
              <>
                New to UniArchive? <Link to="/signup">Create an account</Link>
              </>
            ) : (
              <Link to="/login">Back to login</Link>
            )}
          </p>
          {mode === "login" && (
            <button
              className="text-button"
              onClick={() => {
                const email = prompt(
                  "Email address for a new verification link:",
                );
                if (email)
                  api("/auth/resend-verification", {
                    method: "POST",
                    body: JSON.stringify({ email }),
                  })
                    .then((d) => setMessage(d.message))
                    .catch((e) => setErr(e.message));
              }}
            >
              Resend verification email
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
const navItems = [
  ["", "Dashboard", LayoutDashboard],
  ["library", "Course library", Library],
  ["uploads", "My uploads", FileText],
  ["saved", "Saved collections", Bookmark],
  ["plans", "Upgrade: Plans", ArrowUp],
  ["billing", "Plans & Billing", CreditCard],
  ["overview", "Overview", ChartNoAxesColumn],
  ["help", "Help", HelpCircle],
  ["account", "Account", User],
];
function Shell() {
  const { user, logout, setUser } = useAuth();
  const [mobile, setMobile] = useState(
    () => matchMedia("(max-width: 950px)").matches,
  );
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [err, setErr] = useState("");
  const navigate = useNavigate(),
    location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    const media = matchMedia("(max-width: 950px)");
    const resize = () => setMobile(media.matches);
    const escape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    media.addEventListener("change", resize);
    window.addEventListener("keydown", escape);
    return () => {
      media.removeEventListener("change", resize);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <div className="app-layout">
      <a className="skip" href="#app-main">
        Skip to content
      </a>
      {open && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        id="app-sidebar"
        inert={mobile && !open}
        className={"sidebar " + (open ? "sidebar-open" : "")}
      >
        <Brand />
        <nav aria-label="Application navigation">
          {navItems.map(([to, label, Icon]) => (
            <NavLink
              key={to}
              end={to === ""}
              to={"/app" + (to ? "/" + to : "")}
            >
              <Icon />
              {label}
            </NavLink>
          ))}
          {["Admin", "Moderator"].includes(user.role) && (
            <NavLink to="/app/moderation">
              <ShieldCheck />
              Moderation queue
            </NavLink>
          )}
          {user.role === "Admin" && (
            <>
              <NavLink to="/app/courses">
                <Settings />
                Manage courses
              </NavLink>
              <NavLink to="/app/settings">
                <Settings />
                Settings
              </NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <span className="sidebar-label">Academic Knowledge Repository</span>
          <button
            onClick={async () => {
              try {
                await logout();
                navigate("/login");
              } catch (e) {
                setErr(e.message);
              }
            }}
          >
            <LogOut />
            Log out
          </button>
        </div>
      </aside>
      <div className="app-body">
        <div className="app-topbar">
          <button
            className="icon-button"
            aria-label="Toggle sidebar"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Menu />
          </button>
          <form
            className="global-search"
            onSubmit={(e) => {
              e.preventDefault();
              navigate("/app/library?q=" + encodeURIComponent(search));
            }}
          >
            <Search size={18} />
            <input
              aria-label="Search by course code"
              placeholder="Search by course code, e.g. CSE 421"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
          <Theme />
          <Link to="/app/account" className="user-chip">
            <Avatar user={user} />
            <span>
              <b>{user.name.split(" ")[0]}</b>
              <small>{user.role}</small>
            </span>
          </Link>
        </div>
        <main className="app-content" id="app-main">
          <Alert>{err}</Alert>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
function Dashboard() {
  const { user } = useAuth();
  const { data: courses } = useData("/courses");
  const { data: overview } = useData("/overview");
  const hour = new Date().getHours();
  return (
    <>
      <section className="welcome">
        <div>
          <h1>
            Good {hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"},{" "}
            {user.name.split(" ")[0]} {hour < 18 ? "☀️" : "🌙"}
          </h1>
          <p>Welcome to UniArchive 👋 Your library is ready.</p>
        </div>
        <Link to="/app/upload" className="button mint">
          <Upload size={18} />
          Upload a document
        </Link>
      </section>
      <div className="section-heading">
        <h2>Your resources</h2>
        <Link to="/app/library">
          Browse all courses <ArrowRight size={16} />
        </Link>
      </div>
      <div className="resource-grid">
        {[
          ["Notes", "Lecture and lab notes by course."],
          ["Assignment", "Briefs and deadlines in one place."],
          ["Class Task", "In-class exercises and practice sets."],
          ["Summary", "Short chapter summaries for revision."],
          ["Overview", "Your uploads, approvals and downloads."],
        ].map(([title, desc]) => (
          <Link
            className="resource-card"
            key={title}
            to={
              title === "Overview"
                ? "/app/overview"
                : "/app/library?kind=" + encodeURIComponent(title)
            }
          >
            <span className="resource-icon">
              <FileText />
            </span>
            <h3>{title}</h3>
            <p>{desc}</p>
          </Link>
        ))}
      </div>
      <section className="perspective panel">
        <div>
          <span className="overline">From paper to perspective</span>
          <h2>Turn past papers into understanding</h2>
          <p>
            Open a past paper, read the matching notes and summary, then check
            your answer approach against the class task.
          </p>
        </div>
        <div className="suggested-courses">
          {courses
            ?.filter((c) => Number(c.document_count) > 0)
            .slice(0, 3)
            .map((c) => (
              <Link to={"/app/library?course=" + c.id} key={c.id}>
                <b>
                  {c.code} {c.name}
                </b>
                <span>{c.document_count} files</span>
              </Link>
            ))}
          {courses?.length === 0 && (
            <p>Your admin can add the first course to get started.</p>
          )}
        </div>
      </section>
      <div className="quick-stats">
        {[
          ["Your uploads", overview?.uploads],
          ["Approved", overview?.approved],
          ["Pending review", overview?.pending],
          ["Downloads of your files", overview?.downloads],
        ].map(([label, n]) => (
          <div className="panel" key={label}>
            <strong>{n || 0}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </>
  );
}
const courseSemesterLabel = (value) =>
  value == null ? "Semester not set" : `Semester ${value}`;
const courseCreditsLabel = (value) =>
  value == null ? "Credits not set" : `${Number(value)} credits`;
function CourseEvidence({ course }) {
  if (!course?.catalog_status) return null;
  return (
    <small title={course.catalog_note || undefined}>
      {course.catalog_status === "2026 routine"
        ? "Listed in Summer 2026; Autumn offering unverified"
        : "Earlier source only; current offering unverified"}
    </small>
  );
}
function LibraryPage({ publicView = false }) {
  const [params, setParams] = useSearchParams();
  const { data: courses, err } = useData("/courses");
  const [query, setQuery] = useState(params.get("q") || "");
  const dept = params.get("department") || "",
    semester = params.get("semester") || "",
    course = params.get("course") || "";
  useEffect(() => setQuery(params.get("q") || ""), [params.get("q")]);
  function filter(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }
  const filtered = courses?.filter(
    (c) =>
      (!dept || c.department_id === dept) &&
      (!semester ||
        (semester === "unset"
          ? c.semester == null
          : String(c.semester) === semester)) &&
      (!query ||
        `${c.code} ${c.name}`.toLowerCase().includes(query.toLowerCase())),
  );
  const selected = courses?.find((c) => c.id === course);
  return (
    <>
      <Heading
        title={
          selected ? `${selected.code}: ${selected.name}` : "Course library"
        }
        text={
          selected
            ? `${selected.department_name} · ${courseSemesterLabel(selected.semester)} · ${courseCreditsLabel(selected.credits)}`
            : "Find your department, semester and course. Your next resource is one search away."
        }
        action={
          !publicView && (
            <Link
              className="button primary"
              to={"/app/upload" + (course ? "?course=" + course : "")}
            >
              <Upload size={18} />
              Upload PDF
            </Link>
          )
        }
      />
      <Alert>{err}</Alert>
      {course ? (
        <>
          <button
            className="text-button back-link"
            onClick={() => filter("course", "")}
          >
            <ArrowLeft size={16} />
            All courses
          </button>
          {publicView ? (
            <Empty
              title="Log in to browse documents"
              text="Course files are available to members with verified email addresses."
            />
          ) : (
            <DocumentsPage embedded courseId={course} />
          )}
        </>
      ) : (
        <>
          <div className="filters panel">
            <Field label="Search courses" name="course-search">
              <input
                value={query}
                placeholder="Course code or name"
                onChange={(e) => setQuery(e.target.value)}
              />
            </Field>
            <Field label="Department" name="department">
              <select
                value={dept}
                onChange={(e) => filter("department", e.target.value)}
              >
                <option value="">All departments</option>
                {[
                  ...new Map(
                    courses?.map((c) => [c.department_id, c.department_name]) ||
                      [],
                  ).entries(),
                ].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Semester" name="semester">
              <select
                value={semester}
                onChange={(e) => filter("semester", e.target.value)}
              >
                <option value="">All semesters</option>
                {courses?.some((c) => c.semester == null) && (
                  <option value="unset">Not set</option>
                )}
                {[
                  ...new Set(
                    courses
                      ?.filter((c) => c.semester != null)
                      .map((c) => c.semester),
                  ),
                ]
                  .sort((a, b) => a - b)
                  .map((s) => (
                    <option key={s} value={s}>
                      Semester {s}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          {!courses && !err ? (
            <Loading />
          ) : filtered?.length ? (
            <div className="course-grid">
              {filtered.map((c) => (
                <Link
                  className="course-card panel"
                  key={c.id}
                  to={
                    publicView
                      ? "/login"
                      : "/app/library?" +
                        new URLSearchParams({
                          course: c.id,
                          ...(params.get("kind")
                            ? { kind: params.get("kind") }
                            : {}),
                        })
                  }
                >
                  <div className="course-card-top">
                    <span className="resource-icon">
                      <BookOpen />
                    </span>
                    <span className="badge">
                      {courseCreditsLabel(c.credits)}
                    </span>
                  </div>
                  <span className="overline">{c.code}</span>
                  <h2>{c.name}</h2>
                  <p>
                    {c.department_name} · {courseSemesterLabel(c.semester)}
                  </p>
                  <CourseEvidence course={c} />
                  <div className="course-card-bottom">
                    <span>
                      {c.document_count} approved{" "}
                      {Number(c.document_count) === 1
                        ? "document"
                        : "documents"}
                    </span>
                    <ArrowRight size={18} />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <Empty
              title="No courses found"
              text="Try another search or ask your administrator to add a course."
            />
          )}
        </>
      )}
    </>
  );
}
function Status({ status }) {
  return (
    <span className={"badge status-" + status?.toLowerCase()}>{status}</span>
  );
}
function DocumentsPage({ mode = "library", embedded = false, courseId }) {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [refresh, setRefresh] = useState(0),
    [type, setType] = useState(""),
    [year, setYear] = useState(""),
    [status, setStatus] = useState("Pending"),
    [query, setQuery] = useState(""),
    [edit, setEdit] = useState(null),
    [review, setReview] = useState(null),
    [err, setErr] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const kind = params.get("kind") || "";
  const url =
    "/documents?" +
    new URLSearchParams({
      mode,
      ...(courseId ? { course: courseId } : {}),
      ...(kind ? { kind } : {}),
      ...(type ? { type } : {}),
      ...(year ? { year } : {}),
      ...(mode === "queue" ? { status } : {}),
      ...(query ? { q: query } : {}),
    });
  const { data: docs, err: loadErr } = useData(url, refresh);
  async function action(fn) {
    setErr("");
    setMessage("");
    setBusy(true);
    try {
      const d = await fn();
      setMessage(d.message);
      setRefresh((n) => n + 1);
      return true;
    } catch (e) {
      setErr(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {!embedded && (
        <Heading
          title={
            mode === "mine"
              ? "My uploads"
              : mode === "queue"
                ? "Moderation queue"
                : mode === "saved"
                  ? "Saved collections"
                  : "Documents"
          }
          text={
            mode === "queue"
              ? "Review a PDF and its metadata before making it available to the library."
              : mode === "mine"
                ? "Manage your documents and follow their review status."
                : "Keep useful course material close at hand."
          }
          action={
            mode === "mine" && (
              <Link to="/app/upload" className="button primary">
                <Plus size={18} />
                Upload a document
              </Link>
            )
          }
        />
      )}
      <Alert>{err || loadErr}</Alert>
      <Alert success>{message}</Alert>
      <div className="filters panel compact-filters">
        <Field label="Search documents" name="doc-search">
          <input
            placeholder="Title or course code"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <Field label="Document type" name="type-filter">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {["Note", "Slide", "Past Paper"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Academic year" name="year-filter">
          <input
            type="number"
            min="1990"
            max={new Date().getFullYear() + 1}
            value={year}
            placeholder="All years"
            onChange={(e) => setYear(e.target.value)}
          />
        </Field>
        {mode === "queue" && (
          <Field label="Review status" name="status-filter">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {["Pending", "Approved", "Rejected"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {!docs && !loadErr ? (
        <Loading />
      ) : docs?.length ? (
        <div className="document-list">
          {docs.map((d) => (
            <article className="doc-card panel" key={d.id}>
              <span className="resource-icon">
                <FileText />
              </span>
              <div className="doc-info">
                <div className="doc-title">
                  <h3>{d.title}</h3>
                  <Status status={d.status} />
                </div>
                <p>
                  {d.course_code} · {d.type} · {d.year} · {d.resource_kind}
                </p>
                <small>
                  Shared by {d.uploader_name} ·{" "}
                  {(d.size_bytes / 1024 / 1024).toFixed(2)} MB
                </small>
                {d.reason && (
                  <p className="review-reason">Reviewer: {d.reason}</p>
                )}
              </div>
              <div className="doc-actions">
                {(d.status === "Approved" ||
                  d.uploader_id === user.id ||
                  ["Admin", "Moderator"].includes(user.role)) && (
                  <>
                    <a
                      className="action-button"
                      href={"/api/documents/" + d.id + "/file"}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={"View " + d.title}
                    >
                      <Eye />
                      View
                    </a>
                    <a
                      className="action-button"
                      href={"/api/documents/" + d.id + "/file?download=true"}
                      aria-label={"Download " + d.title}
                    >
                      <Download />
                      Download
                    </a>
                  </>
                )}
                {d.status === "Approved" && (
                  <button
                    className={"action-button " + (d.saved ? "saved" : "")}
                    disabled={busy}
                    aria-label={(d.saved ? "Unsave " : "Save ") + d.title}
                    onClick={() =>
                      action(() =>
                        api("/documents/" + d.id + "/save", { method: "POST" }),
                      )
                    }
                  >
                    <Bookmark />
                    {d.saved ? "Saved" : "Save"}
                  </button>
                )}
                {(d.uploader_id === user.id || user.role === "Admin") && (
                  <>
                    <button
                      className="action-button"
                      onClick={() => setEdit(d)}
                      aria-label={"Edit " + d.title}
                    >
                      <Pencil />
                      Edit
                    </button>
                    <button
                      className="action-button danger-text"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            "Permanently delete “" + d.title + "” and its PDF?",
                          )
                        )
                          action(() =>
                            api("/documents/" + d.id, { method: "DELETE" }),
                          );
                      }}
                      aria-label={"Delete " + d.title}
                    >
                      <Trash2 />
                      Delete
                    </button>
                  </>
                )}
                {mode === "queue" && d.status === "Pending" && (
                  <button
                    className="button primary small"
                    onClick={() => setReview(d)}
                  >
                    <ShieldCheck size={16} />
                    Review
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title={
            mode === "queue"
              ? "No " + status.toLowerCase() + " submissions"
              : "No documents found"
          }
          text={
            mode === "mine"
              ? "Upload a PDF to share your first resource."
              : "Try changing your filters, or check back after new uploads are reviewed."
          }
        />
      )}{" "}
      {edit && (
        <Modal title="Edit document" onClose={() => setEdit(null)}>
          <Alert>{err}</Alert>
          <DocumentForm
            initial={edit}
            onSubmit={async (b) => {
              if (
                await action(() =>
                  api("/documents/" + edit.id, {
                    method: "PUT",
                    body: JSON.stringify(b),
                  }),
                )
              )
                setEdit(null);
            }}
          />
          <p className="muted small-text">
            Changes return the document to the moderation queue.
          </p>
        </Modal>
      )}
      {review && (
        <Modal title="Review submission" onClose={() => setReview(null)}>
          <Alert>{err}</Alert>
          <h3>{review.title}</h3>
          <a
            className="button"
            target="_blank"
            rel="noreferrer"
            href={"/api/documents/" + review.id + "/file"}
          >
            <Eye size={18} />
            Open PDF
          </a>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const b = Object.fromEntries(new FormData(e.currentTarget));
              if (
                await action(() =>
                  api("/submissions/" + review.id, {
                    method: "PATCH",
                    body: JSON.stringify(b),
                  }),
                )
              )
                setReview(null);
            }}
          >
            <Field label="Decision" name="status">
              <select name="status">
                <option>Approved</option>
                <option>Rejected</option>
              </select>
            </Field>
            <Field label="Review note (optional)" name="reason">
              <textarea name="reason" maxLength={500} rows={3} />
            </Field>
            <button className="button primary full" disabled={busy}>
              Save review
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function Modal({ title, onClose, children }) {
  const ref = useRef();
  useEffect(() => {
    ref.current.showModal();
    const fn = (e) => {
      e.preventDefault();
      onClose();
    };
    ref.current.addEventListener("cancel", fn);
    return () => ref.current?.removeEventListener("cancel", fn);
  }, []);
  return (
    <dialog ref={ref} className="app-dialog" aria-labelledby="dialog-title">
      <button
        className="icon-button close"
        onClick={onClose}
        aria-label="Close dialog"
      >
        <X />
      </button>
      <h2 id="dialog-title">{title}</h2>
      {children}
    </dialog>
  );
}
function DocumentForm({
  initial = {},
  onSubmit,
  upload = false,
  maxUpload = 20,
  progress = null,
}) {
  const { data: courses, err } = useData("/courses");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setBusy(true);
        try {
          const form = new FormData(e.currentTarget);
          await onSubmit(upload ? form : Object.fromEntries(form));
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Alert>{err || error}</Alert>
      <Field
        label="Document title"
        name="title"
        defaultValue={initial.title}
        required
        maxLength={180}
      />
      <Field label="Course" name="course_id">
        <select
          name="course_id"
          defaultValue={initial.course_id || ""}
          required
        >
          <option value="" disabled>
            Select a course
          </option>
          {courses?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code}: {c.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="form-grid">
        <Field label="Document type" name="type">
          <select name="type" defaultValue={initial.type || "Note"}>
            {["Note", "Slide", "Past Paper"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field
          label="Academic year"
          name="year"
          type="number"
          defaultValue={initial.year || new Date().getFullYear()}
          min={1990}
          max={new Date().getFullYear() + 1}
          required
        />
      </div>
      <Field label="Resource category" name="resource_kind">
        <select
          name="resource_kind"
          defaultValue={initial.resource_kind || "Notes"}
        >
          {["Notes", "Assignment", "Class Task", "Summary"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </Field>
      {upload && (
        <div className="upload-zone">
          <Upload />
          <Field
            label={`PDF document (up to ${maxUpload} MB)`}
            name="file"
            type="file"
            accept="application/pdf,.pdf"
            required
          />
          <p>Only readable, unencrypted PDFs are accepted.</p>
        </div>
      )}
      <button
        className="button primary full"
        disabled={busy || !courses?.length}
      >
        {busy
          ? progress === null
            ? "Saving…"
            : progress === 100
              ? "Checking PDF and saving…"
              : `Uploading… ${progress}%`
          : upload
            ? "Submit for review"
            : "Save changes"}
      </button>
      {courses?.length === 0 && (
        <p className="muted">
          An administrator needs to add a course before you can upload.
        </p>
      )}
    </form>
  );
}
function UploadPage() {
  const [params] = useSearchParams();
  const [message, setMessage] = useState("");
  const [uploadProgress, setUploadProgress] = useState(null);
  const { data: config } = useData("/config");
  return (
    <>
      <Heading
        title="Upload a document"
        text="Share something useful. Every PDF is reviewed before it enters the library."
      />
      <div className="upload-layout">
        <section className="panel form-panel">
          {message ? (
            <>
              <CheckCircle className="success-icon" />
              <h2>Submission received</h2>
              <Alert success>{message}</Alert>
              <div className="hero-actions">
                <Link to="/app/uploads" className="button primary">
                  View my uploads
                </Link>
                <button className="button" onClick={() => setMessage("")}>
                  Upload another
                </button>
              </div>
            </>
          ) : (
            <DocumentForm
              upload
              progress={uploadProgress}
              maxUpload={config?.maxUploadMb || 20}
              initial={{ course_id: params.get("course") || "" }}
              onSubmit={async (body) => {
                if (!config?.chunkedUploads) {
                  const d = await api("/documents", { method: "POST", body });
                  setMessage(d.message);
                  return;
                }
                const file = body.get("file");
                let uploadId;
                try {
                  setUploadProgress(0);
                  const fields = Object.fromEntries(body);
                  delete fields.file;
                  const session = await api("/uploads", {
                    method: "POST",
                    body: JSON.stringify({
                      ...fields,
                      filename: file.name,
                      size: file.size,
                    }),
                  });
                  uploadId = session.id;
                  for (
                    let offset = 0, index = 0;
                    offset < file.size;
                    offset += session.chunkSize, index++
                  ) {
                    await api(`/uploads/${uploadId}/chunks/${index}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/octet-stream" },
                      body: file.slice(offset, offset + session.chunkSize),
                    });
                    setUploadProgress(
                      Math.round(
                        (Math.min(file.size, offset + session.chunkSize) /
                          file.size) *
                          100,
                      ),
                    );
                  }
                  const result = await api(`/uploads/${uploadId}/complete`, {
                    method: "POST",
                  });
                  setMessage(result.message);
                } catch (error) {
                  if (uploadId)
                    await api(`/uploads/${uploadId}`, {
                      method: "DELETE",
                    }).catch(() => {});
                  throw error;
                } finally {
                  setUploadProgress(null);
                }
              }}
            />
          )}
        </section>
        <aside className="panel guidelines">
          <span className="resource-icon">
            <ShieldCheck />
          </span>
          <h2>A library we can trust</h2>
          <p>
            Give your PDF a clear title and check the course, year and type
            before submitting.
          </p>
          <ul>
            <li>Share material you have permission to distribute.</li>
            <li>Remove personal or sensitive information.</li>
            <li>Avoid duplicate or unreadable files.</li>
            <li>Follow your submission in My uploads.</li>
          </ul>
          <p className="callout">
            <Clock size={18} />
            Your upload starts as Pending. A moderator will approve it or
            explain why it was rejected.
          </p>
        </aside>
      </div>
    </>
  );
}
function Plans({ compact = false }) {
  const { user } = useAuth();
  const [contact, setContact] = useState(false);
  const { data: config } = useData("/config");
  return (
    <>
      {compact ? (
        <>
          <h2>Plans</h2>
          <p className="section-intro">
            Prices shown are placeholders. Billing is sample data; no payment is
            collected.
          </p>
        </>
      ) : (
        <Heading
          title="Upgrade your plan"
          text="Choose the plan that fits how you study. Prices and billing are sample data."
        />
      )}
      <div className="three-grid plan-grid">
        {[
          {
            name: "Free",
            price: "$0",
            items: [
              "Browse and download approved files",
              "Upload up to 10 documents",
              "Search by course code",
            ],
          },
          {
            name: "Pro",
            price: "$5",
            items: [
              "Everything in Free",
              "Unlimited uploads",
              "Priority moderation review",
              "Saved collections",
            ],
          },
          {
            name: "Institution",
            price: "Custom",
            items: [
              "Everything in Pro",
              "Admin and moderator tools",
              "Department reports",
              "Bulk course import",
            ],
          },
        ].map((p) => (
          <article
            className={"plan " + (p.name === "Pro" ? "featured" : "")}
            key={p.name}
          >
            <div className="plan-label">
              <h3>{p.name}</h3>
              {p.name === "Pro" && <span className="badge">Popular</span>}
            </div>
            <p className="price">
              {p.price}
              {p.name !== "Institution" && <span> /month</span>}
            </p>
            {compact ? (
              <p>{p.items.slice(0, 2).join(", ")}.</p>
            ) : (
              <ul className="plan-features">
                {p.items.map((x) => (
                  <li key={x}>
                    <Check size={16} />
                    {x}
                  </li>
                ))}
              </ul>
            )}
            {p.name === "Free" ? (
              <Link className="button" to={user ? "/app/library" : "/signup"}>
                {user ? "Current plan" : "Start free"}
              </Link>
            ) : (
              <button
                className={"button " + (p.name === "Pro" ? "primary" : "")}
                onClick={() => setContact(true)}
              >
                {p.name === "Pro" ? "Explore Pro" : "Contact us"}
              </button>
            )}
          </article>
        ))}
      </div>
      {!compact && (
        <p className="callout">
          This course project provides all core library features on Free. Pro
          and Institution are plan previews; subscription upgrades, priority
          scheduling and bulk imports are not activated.
        </p>
      )}
      {contact && (
        <Modal title="Plans preview" onClose={() => setContact(false)}>
          <p>
            Pro and Institution pricing is illustrative. Payments and
            subscriptions are outside this project’s scope. All core library
            features are available on Free.
          </p>
          {config?.supportEmail ? (
            <a
              className="button primary"
              href={"mailto:" + config.supportEmail}
            >
              Contact the team
            </a>
          ) : (
            <p className="muted">
              A support contact has not been configured yet.
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
function Billing() {
  const { data, err } = useData("/billing");
  return (
    <>
      <Heading
        title="Plans & Billing"
        text="Your plan and sample payment history."
      />
      <Alert>{err}</Alert>
      <div className="panel current-plan">
        <div>
          <span className="overline">Current plan</span>
          <h2>{data?.plan || "Free"}</h2>
          <p>Explore the plan previews to see what’s next for UniArchive.</p>
        </div>
        <Link className="button primary" to="/app/plans">
          View plans
        </Link>
      </div>
      <div className="section-heading">
        <h2>Payment history</h2>
        <span className="badge">Sample data</span>
      </div>
      <div className="table-wrap panel">
        <table>
          <thead>
            <tr>
              {["Date", "Plan", "Amount", "Status", "Receipt"].map((x) => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.payments.map((p) => (
              <tr key={p.id}>
                <td>{new Date(p.created_at).toLocaleDateString()}</td>
                <td>{p.plan}</td>
                <td>${Number(p.amount).toFixed(2)}</td>
                <td>
                  <Status status={p.status} />
                </td>
                <td>Sample record · no receipt</td>
              </tr>
            ))}
            {data?.payments.length === 0 && (
              <tr>
                <td colSpan={5}>
                  No payment records. No charges have been made.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="small-text muted">
        Payment processing is not enabled. Sample records do not represent a
        real transaction.
      </p>
    </>
  );
}
function Overview() {
  const { data, err } = useData("/overview");
  const total = data?.uploads || 0;
  return (
    <>
      <Heading
        title="Your overview"
        text="See how your contributions support the university library."
      />
      <Alert>{err}</Alert>
      <div className="quick-stats overview-stats">
        {[
          ["Uploads", data?.uploads, Upload],
          ["Approved", data?.approved, CheckCircle],
          ["Pending", data?.pending, Clock],
          ["Downloads", data?.downloads, Download],
        ].map(([label, n, Icon]) => (
          <div className="panel" key={label}>
            <span className="resource-icon">
              <Icon />
            </span>
            <strong>{n || 0}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="overview-grid">
        <section className="panel chart-panel">
          <h2>Submission status</h2>
          {total ? (
            <>
              <div
                className="status-bar"
                role="img"
                aria-label={`${data.approved || 0} approved, ${data.pending || 0} pending, ${data.rejected || 0} rejected`}
              >
                {["approved", "pending", "rejected"].map((s) => (
                  <span
                    key={s}
                    className={"bar-" + s}
                    style={{ width: ((data[s] || 0) / total) * 100 + "%" }}
                  />
                ))}
              </div>
              <div className="chart-legend">
                {["approved", "pending", "rejected"].map((s) => (
                  <p key={s}>
                    <i className={"bar-" + s} />
                    <span>{s[0].toUpperCase() + s.slice(1)}</span>
                    <b>{data[s] || 0}</b>
                  </p>
                ))}
              </div>
            </>
          ) : (
            <Empty
              title="Your story starts here"
              text="Upload a PDF to see your contribution statistics."
            />
          )}
        </section>
        <section className="panel chart-panel">
          <h2>Downloads of your files</h2>
          <p className="muted small-text">
            Most recent 14 days with download activity
          </p>
          {data?.activity.length ? (
            <div className="activity-chart">
              {data.activity.map((day) => (
                <div key={day.day} className="activity-column">
                  <strong>{day.count}</strong>
                  <div
                    style={{
                      height:
                        (Number(day.count) /
                          Math.max(
                            ...data.activity.map((d) => Number(d.count)),
                          )) *
                          130 +
                        8 +
                        "px",
                    }}
                  />
                  <small>{day.day.slice(5)}</small>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="No downloads yet"
              text="Download activity appears when members download your files."
            />
          )}
        </section>
      </div>
    </>
  );
}
const faqs = [
  [
    "How do I upload a document?",
    "Open a course, choose Upload PDF, select a PDF and enter its title, type, academic year and course. Uploads start as Pending.",
  ],
  [
    "Why is my file Pending?",
    "Every upload waits for a moderator. Approved files become available in the course library. Review notes appear under My uploads if a file is rejected.",
  ],
  [
    "Can I edit or delete my upload?",
    "Yes. Open My uploads to edit metadata or delete a file. Editing metadata returns the document to review to keep the library accurate.",
  ],
  [
    "How do I find a course?",
    "Browse by department and semester in the Course library, or search a code such as CSE 421 in the search bar.",
  ],
  [
    "What files can I upload?",
    "Only readable, unencrypted PDFs are accepted. The maximum is 20 MB, or a lower limit set by your administrator.",
  ],
  [
    "How do I verify my email or reset a password?",
    "Use the link sent to your email. For local development without SMTP, run npm run mail in the project folder to read the messages. Reset links expire after one hour, verification links after 24 hours.",
  ],
  [
    "Do I need to pay?",
    "No. This project uses sample pricing and billing data. No card information is collected and no payment is processed.",
  ],
];
function Help() {
  const { data: config } = useData("/config");
  return (
    <>
      <Heading
        title="Help centre"
        text="Answers to common questions about uploading, review and your account."
      />
      <div className="faq-grid">
        {faqs.map(([q, a]) => (
          <details className="panel faq" key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
      <section className="panel support-panel">
        <div>
          <h2>Still need help?</h2>
          <p>
            {config?.supportEmail
              ? "Send the team a message and include the course code or document title."
              : "Ask your university’s UniArchive administrator for help with access or submissions."}
          </p>
        </div>
        {config?.supportEmail && (
          <a className="button primary" href={"mailto:" + config.supportEmail}>
            Contact support
          </a>
        )}
      </section>
    </>
  );
}
function CoursesAdmin() {
  const [refresh, setRefresh] = useState(0),
    [edit, setEdit] = useState(null),
    [depEdit, setDepEdit] = useState(null),
    [err, setErr] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const { data: courses, err: loadErr } = useData("/courses", refresh),
    { data: departments } = useData("/departments", refresh);
  async function act(fn) {
    setErr("");
    setMessage("");
    setBusy(true);
    try {
      const d = await fn();
      setMessage(d.message || "Saved.");
      setRefresh((n) => n + 1);
      return true;
    } catch (e) {
      setErr(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="Manage courses"
        text={
          courses
            ? `${courses.length} courses in the directory. Manage departments, semesters and course details.`
            : "Manage departments, semesters and course details."
        }
        action={
          <button className="button primary" onClick={() => setEdit({})}>
            <Plus size={18} />
            Add course
          </button>
        }
      />
      <Alert>{err || loadErr}</Alert>
      <Alert success>{message}</Alert>
      <div className="section-heading">
        <h2>Departments</h2>
        <button className="text-button" onClick={() => setDepEdit({})}>
          Add department
        </button>
      </div>
      <div className="departments-list">
        {departments?.map((d) => (
          <div className="department-chip" key={d.id}>
            <b>{d.name}</b>
            <button
              className="icon-button"
              aria-label={"Edit " + d.name}
              onClick={() => setDepEdit(d)}
            >
              <Pencil size={15} />
            </button>
            <button
              className="icon-button danger-text"
              aria-label={"Delete " + d.name}
              disabled={busy}
              onClick={() => {
                if (confirm("Delete this empty department?"))
                  act(() => api("/departments/" + d.id, { method: "DELETE" }));
              }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <div className="table-wrap panel">
        <table>
          <thead>
            <tr>
              <th>Course</th>
              <th>Department</th>
              <th>Semester</th>
              <th>Credits</th>
              <th>Files</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {courses?.map((c) => (
              <tr key={c.id}>
                <td>
                  <b>{c.code}</b>
                  <small>{c.name}</small>
                  <CourseEvidence course={c} />
                </td>
                <td>{c.department_name}</td>
                <td>{c.semester ?? "Not set"}</td>
                <td>{c.credits ?? "Not set"}</td>
                <td>{c.document_count}</td>
                <td>
                  <div className="row-actions">
                    <button
                      className="action-button"
                      onClick={() => setEdit(c)}
                    >
                      <Pencil />
                      Edit
                    </button>
                    <button
                      className="action-button danger-text"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            `Delete ${c.code}? This also deletes its PDFs and submissions.`,
                          )
                        ) {
                          const approved = Number(c.document_count) > 0;
                          if (
                            approved &&
                            !confirm(
                              "This course has approved documents. Permanently remove all of them?",
                            )
                          )
                            return;
                          act(() =>
                            api(
                              "/courses/" +
                                c.id +
                                (approved ? "?confirm=true" : ""),
                              { method: "DELETE" },
                            ),
                          );
                        }
                      }}
                    >
                      <Trash2 />
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {courses?.length === 0 && (
              <tr>
                <td colSpan={6}>
                  Add a department, then create your first course.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal
          title={edit.id ? "Edit course" : "Add course"}
          onClose={() => setEdit(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const b = Object.fromEntries(new FormData(e.currentTarget));
              if (
                await act(() =>
                  api("/courses" + (edit.id ? "/" + edit.id : ""), {
                    method: edit.id ? "PUT" : "POST",
                    body: JSON.stringify(b),
                  }),
                )
              )
                setEdit(null);
            }}
          >
            <Alert>{err}</Alert>
            <Field
              name="code"
              label="Course code"
              defaultValue={edit.code}
              required
              maxLength={30}
            />
            <Field
              name="name"
              label="Course name"
              defaultValue={edit.name}
              required
              maxLength={150}
            />
            <Field name="department_id" label="Department">
              <select
                name="department_id"
                defaultValue={edit.department_id || ""}
                required
              >
                <option value="" disabled>
                  Select department
                </option>
                {departments?.map((d) => (
                  <option value={d.id} key={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="form-grid">
              <Field
                name="semester"
                label="Semester"
                type="number"
                min="1"
                max="16"
                defaultValue={edit.semester ?? ""}
                placeholder="Not set"
              />
              <Field
                name="credits"
                label="Credit hours"
                type="number"
                min="0.5"
                max="10"
                step="0.5"
                defaultValue={edit.credits ?? ""}
                placeholder="Not set"
              />
            </div>
            <button className="button primary full" disabled={busy}>
              Save course
            </button>
          </form>
        </Modal>
      )}
      {depEdit && (
        <Modal
          title={depEdit.id ? "Edit department" : "Add department"}
          onClose={() => setDepEdit(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act(() =>
                  api("/departments" + (depEdit.id ? "/" + depEdit.id : ""), {
                    method: depEdit.id ? "PUT" : "POST",
                    body: JSON.stringify(
                      Object.fromEntries(new FormData(e.currentTarget)),
                    ),
                  }),
                )
              )
                setDepEdit(null);
            }}
          >
            <Alert>{err}</Alert>
            <Field
              name="name"
              label="Department name"
              defaultValue={depEdit.name}
              maxLength={120}
              required
            />
            <button className="button primary full" disabled={busy}>
              Save department
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function Avatar({ user, large = false }) {
  const [failed, setFailed] = useState(null);
  return (
    <span className={"avatar" + (large ? " large" : "")}>
      {user.avatar_url && failed !== user.avatar_url ? (
        <img
          src={user.avatar_url}
          alt={`${user.name}'s profile picture`}
          onError={() => setFailed(user.avatar_url)}
        />
      ) : (
        user.name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
function ProfilePicture() {
  const { user, setUser } = useAuth();
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function clear() {
    setFile(null);
    if (input.current) input.current.value = "";
  }
  async function save(remove = false) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body = new FormData();
      if (!remove) body.append("picture", file);
      const result = await api("/account/avatar", {
        method: remove ? "DELETE" : "PUT",
        ...(remove ? {} : { body }),
      });
      setUser(result.user);
      clear();
      setMessage(result.message);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="profile-picture-controls">
      <label htmlFor="profile-picture">Profile picture</label>
      <p id="profile-picture-help">JPEG, PNG or WebP · Up to 2 MB</p>
      <input
        ref={input}
        id="profile-picture"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-describedby="profile-picture-help"
        disabled={busy}
        onChange={(event) => {
          const selected = event.target.files?.[0];
          setError("");
          setMessage("");
          clear();
          if (!selected) return;
          if (
            !["image/jpeg", "image/png", "image/webp"].includes(selected.type)
          ) {
            setError("Choose a JPEG, PNG, or WebP image.");
            return;
          }
          if (selected.size > 2 * 1024 * 1024) {
            setError("Profile pictures must be no larger than 2 MB.");
            return;
          }
          setFile(selected);
        }}
      />
      {preview && (
        <img
          className="picture-preview"
          src={preview}
          alt="New profile picture preview"
        />
      )}
      <div className="picture-actions">
        {file && (
          <>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => save()}
            >
              {busy ? "Saving…" : "Save picture"}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={clear}
            >
              Cancel
            </button>
          </>
        )}
        {user.avatar_url && !file && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => save(true)}
          >
            {busy ? "Removing…" : "Remove picture"}
          </button>
        )}
      </div>
      <Alert>{error}</Alert>
      <Alert success>{message}</Alert>
    </div>
  );
}
function Account() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [refresh, setRefresh] = useState(0),
    [edit, setEdit] = useState(null),
    [remove, setRemove] = useState(false),
    [err, setErr] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const { data: users, err: loadErr } = useData(
    user.role === "Admin" ? "/users" : "/auth/me",
    refresh,
  );
  async function act(fn) {
    setErr("");
    setMessage("");
    setBusy(true);
    try {
      const d = await fn();
      setMessage(d.message);
      setRefresh((n) => n + 1);
      return true;
    } catch (e) {
      setErr(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="Account"
        text={
          user.role === "Admin"
            ? "Manage users, roles and access."
            : "Manage your UniArchive account."
        }
        action={
          user.role === "Admin" && (
            <button className="button primary" onClick={() => setEdit({})}>
              <Plus size={18} />
              Add user
            </button>
          )
        }
      />
      <Alert>{err || loadErr}</Alert>
      <Alert success>{message}</Alert>
      <section className="panel profile-panel">
        <Avatar user={user} large />
        <div>
          <h2>{user.name}</h2>
          <p>{user.email}</p>
          <span className="badge">{user.role}</span>{" "}
          <Status status={user.status} />
        </div>
        <ProfilePicture />
      </section>
      {user.role === "Admin" && (
        <>
          <div className="section-heading">
            <h2>University members</h2>
            <span className="muted">{users?.length || 0} members</span>
          </div>
          <div className="table-wrap panel">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Uploads</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {users?.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <b>{u.name}</b>
                      <small>
                        {u.email}
                        {!u.verified ? " · Unverified" : ""}
                      </small>
                    </td>
                    <td>{u.role}</td>
                    <td>
                      <Status status={u.status} />
                    </td>
                    <td>{u.upload_count}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="action-button"
                          onClick={() => setEdit(u)}
                        >
                          <Pencil />
                          Edit
                        </button>
                        <button
                          className="action-button danger-text"
                          disabled={busy}
                          onClick={async () => {
                            if (
                              confirm(
                                "Permanently delete " +
                                  u.name +
                                  " and all their uploads?",
                              )
                            ) {
                              if (
                                (await act(() =>
                                  api("/users/" + u.id, { method: "DELETE" }),
                                )) &&
                                u.id === user.id
                              ) {
                                setUser(null);
                                navigate("/");
                              }
                            }
                          }}
                        >
                          <Trash2 />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <section className="panel danger-zone">
        <div>
          <h2>Delete your account</h2>
          <p>
            Remove your account, uploads, submissions and stored PDFs
            permanently.
          </p>
        </div>
        <button
          className="button danger-button"
          onClick={() => setRemove(true)}
        >
          Delete account
        </button>
      </section>
      {edit && (
        <Modal
          title={edit.id ? "Edit user access" : "Invite a user"}
          onClose={() => setEdit(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const b = Object.fromEntries(new FormData(e.currentTarget));
              const self = edit.id === user.id;
              if (
                await act(() =>
                  api("/users" + (edit.id ? "/" + edit.id : ""), {
                    method: edit.id ? "PATCH" : "POST",
                    body: JSON.stringify(b),
                  }),
                )
              ) {
                setEdit(null);
                if (self) {
                  setUser(null);
                  navigate("/login");
                }
              }
            }}
          >
            <Alert>{err}</Alert>
            {edit.id ? (
              <>
                <h3>{edit.name}</h3>
                <p>{edit.email}</p>
              </>
            ) : (
              <>
                <Field name="name" label="Full name" required maxLength={100} />
                <Field
                  name="email"
                  label="Email address"
                  type="email"
                  required
                />
              </>
            )}
            <Field name="role" label="Role">
              <select name="role" defaultValue={edit.role || "Student"}>
                {["Student", "Moderator", "Admin"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            {edit.id && (
              <Field name="status" label="Status">
                <select name="status" defaultValue={edit.status}>
                  {["Active", "Suspended", "Banned"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
            )}
            <p className="small-text muted">
              {edit.id
                ? "Changing access revokes this user’s existing sessions."
                : "The user receives email verification and password setup links."}
            </p>
            <button className="button primary full" disabled={busy}>
              {edit.id ? "Save access" : "Send invitation"}
            </button>
          </form>
        </Modal>
      )}
      {remove && (
        <Modal title="Delete your account?" onClose={() => setRemove(false)}>
          <p>
            This permanently removes your profile and all your uploads. Enter
            your password to confirm.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act(() =>
                  api("/account", {
                    method: "DELETE",
                    body: JSON.stringify(
                      Object.fromEntries(new FormData(e.currentTarget)),
                    ),
                  }),
                )
              ) {
                setUser(null);
                navigate("/");
              }
            }}
          >
            <Alert>{err}</Alert>
            <Field
              name="password"
              label="Current password"
              type="password"
              autoComplete="current-password"
              required
            />
            <button className="button danger-button full" disabled={busy}>
              Permanently delete my account
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function SettingsPage() {
  const [refresh, setRefresh] = useState(0),
    [err, setErr] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const { data: config } = useData("/config", refresh);
  return (
    <>
      <Heading
        title="Repository settings"
        text="Set the maximum PDF size for university uploads."
      />
      <div className="panel form-panel narrow">
        <Alert>{err}</Alert>
        <Alert success>{message}</Alert>
        {config && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setErr("");
              try {
                const d = await api("/settings", {
                  method: "PATCH",
                  body: JSON.stringify(
                    Object.fromEntries(new FormData(e.currentTarget)),
                  ),
                });
                setMessage(d.message);
                setRefresh((n) => n + 1);
              } catch (e) {
                setErr(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field
              label="Maximum PDF size (MB)"
              name="maxUploadMb"
              type="number"
              min="1"
              max="20"
              defaultValue={config.maxUploadMb}
              required
            />
            <p className="small-text muted">
              Choose between 1 and 20 MB. Existing files are unaffected.
            </p>
            <button className="button primary" disabled={busy}>
              Save settings
            </button>
          </form>
        )}
      </div>
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
