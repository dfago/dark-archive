import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  api,
  readLocal,
  writeLocal,
  guestProgress,
  formatDate,
  downloadJSON,
} from "./api.js";
import { starterArticles } from "./starter-articles.js";
import { Link } from "./components/Link.jsx";
import Reader from "./components/Reader.jsx";
import Admin from "./components/Admin.jsx";
import OwnerSetup from "./components/OwnerSetup.jsx";
import "./styles.css";

function legacyArticles() {
  const saved = readLocal("articles", starterArticles);
  if (!Array.isArray(saved)) return starterArticles;
  return saved
    .filter(
      (a) =>
        a &&
        a.status === "published" &&
        typeof a.title === "string" &&
        typeof a.content === "string" &&
        typeof a.slug === "string",
    )
    .map((a) => ({ ...a, id: String(a.id), likeCount: 0, liked: false }));
}
function pathNow() {
  try {
    return decodeURI(window.location.pathname);
  } catch {
    return "/";
  }
}
function App() {
  const [path, setPath] = useState(pathNow);
  const [theme, setTheme] = useState(() => readLocal("archive:theme", "dark"));
  const [user, setUser] = useState(null);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState({ articles: [], series: [] });
  const [library, setLibrary] = useState([]);
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const actionLocks = useRef(new Set());
  const fallbackArticles = useMemo(legacyArticles, []);
  const [guestBookmarks, setGuestBookmarks] = useState(() => {
    const v = readLocal("archive:bookmarks", []);
    return Array.isArray(v) ? v.map(String) : [];
  });
  function notify(message) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 6000);
  }
  function navigate(to) {
    if (to !== window.location.pathname) history.pushState(null, "", to);
    setPath(pathNow());
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  useEffect(() => {
    const pop = () => {
      setPath(pathNow());
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
      clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    writeLocal("archive:theme", theme);
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "light" ? "#f5f1e8" : "#09090b");
  }, [theme]);
  useEffect(() => {
    // Discard obsolete credentials and client-side administrator flags.
    for (const key of ["admin", "users", "currentUser"]) {
      try {
        localStorage.removeItem(key);
      } catch {}
    }
    refresh();
  }, []);
  async function refresh() {
    try {
      const [session, nextCatalog] = await Promise.all([
        api("/session"),
        api("/catalog"),
      ]);
      setUser(session.user);
      setCatalog(nextCatalog);
      setOnline(true);
      if (session.user) {
        try {
          setLibrary((await api("/me/library")).articles);
        } catch {
          notify("Не удалось загрузить библиотеку. Повторите позже.");
        }
      } else setLibrary([]);
    } catch {
      setOnline(false);
      setUser(null);
      setCatalog({ articles: fallbackArticles, series: [] });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const story = path.startsWith("/story/")
      ? catalog.articles.find((a) => a.slug === path.slice(7))
      : null;
    document.title = story
      ? `${story.title} — Тёмный архив`
      : path === "/library"
        ? "Моя библиотека — Тёмный архив"
        : "Тёмный архив — истории, которые не отпускают";
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        "content",
        story?.excerpt ||
          "Мистические рассказы Артёма: советские экспедиции, славянский фольклор и места, которых нет на картах.",
      );
  }, [path, catalog]);
  function updateArticle(id, patch) {
    setCatalog((previous) => ({
      ...previous,
      articles: previous.articles.map((a) =>
        a.id === id ? { ...a, ...patch } : a,
      ),
    }));
    setLibrary((previous) =>
      previous.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    );
  }
  function updateProgress(article, position) {
    setLibrary((previous) => {
      const entry = {
        ...article,
        ...position,
        lastReadAt: new Date().toISOString(),
      };
      return previous.some((a) => a.id === article.id)
        ? previous.map((a) => (a.id === article.id ? { ...a, ...entry } : a))
        : [...previous, entry];
    });
  }
  async function toggleAction(article, kind) {
    const key = `${article.id}:${kind}`;
    if (actionLocks.current.has(key)) return null;
    if (kind === "bookmark" && !user) {
      const active = !guestBookmarks.includes(article.id);
      const next = active
        ? [...guestBookmarks, article.id]
        : guestBookmarks.filter((id) => id !== article.id);
      setGuestBookmarks(next);
      writeLocal("archive:bookmarks", next);
      updateArticle(article.id, { bookmarked: active });
      notify(
        active
          ? "Сохранено в закладки на этом устройстве."
          : "Закладка удалена.",
      );
      return { bookmarked: active };
    }
    if (!online) {
      notify("Это действие временно недоступно. Можно продолжить читать.");
      return null;
    }
    if (!user) {
      navigate("/login");
      return null;
    }
    const field = kind === "like" ? "liked" : "bookmarked";
    actionLocks.current.add(key);
    try {
      const result = await api(`/articles/${article.id}/${kind}`, {
        method: "PUT",
        body: { active: !article[field] },
      });
      const patch = { [field]: result.active, likeCount: result.likeCount };
      updateArticle(article.id, patch);
      if (kind === "bookmark") setLibrary((await api("/me/library")).articles);
      return patch;
    } catch (error) {
      notify(error.message);
      return null;
    } finally {
      actionLocks.current.delete(key);
    }
  }
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
      setUser(null);
      setLibrary([]);
      await refresh();
      navigate("/");
    } catch (error) {
      notify(error.message);
    }
  }
  async function signedIn(nextUser) {
    setUser(nextUser);
    // Move this device's guest bookmarks to the account, without deleting the backup.
    const saved = guestBookmarks.filter((id) =>
      catalog.articles.some((a) => a.id === id),
    );
    await Promise.allSettled(
      saved.map((id) =>
        api(`/articles/${id}/bookmark`, {
          method: "PUT",
          body: { active: true },
        }),
      ),
    );
    await refresh();
    navigate("/");
  }
  const articles = catalog.articles.map((a) => ({
    ...a,
    bookmarked: user ? a.bookmarked : guestBookmarks.includes(a.id),
  }));
  const filtered = articles.filter((a) =>
    `${a.title} ${a.excerpt} ${a.seriesTitle || ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const guestLibrary = articles
    .filter((a) => a.bookmarked || guestProgress(a.id))
    .map((a) => ({ ...a, ...guestProgress(a.id) }));
  const myLibrary = user ? library : guestLibrary;
  const recent = [...myLibrary]
    .filter((a) => a.percent > 0 && a.percent < 100)
    .sort((a, b) => new Date(b.lastReadAt) - new Date(a.lastReadAt))[0];
  const seriesSlug = path.startsWith("/series/") ? path.slice(8) : null;
  const series = catalog.series.find((s) => s.slug === seriesSlug);
  const seriesArticles = articles
    .filter((a) => a.seriesSlug === seriesSlug)
    .sort((a, b) => a.episode - b.episode);
  const card = (article) => (
    <article className="card" key={article.id}>
      <Link
        to={`/story/${article.slug}`}
        navigate={navigate}
        className="cover-link"
        aria-label={`Читать ${article.title}`}
      >
        {article.cover ? (
          <img loading="lazy" src={article.cover} alt="" />
        ) : (
          <div className="cover-placeholder">ТЁМНЫЙ АРХИВ</div>
        )}
      </Link>
      <div className="card-body">
        <div className="article-meta">
          <span>{formatDate(article.date)}</span>
          <span>
            {article.readMinutes ||
              Math.max(
                1,
                Math.ceil((article.content?.length || 1000) / 1000),
              )}{" "}
            мин чтения
          </span>
        </div>
        {article.seriesTitle && (
          <Link
            to={`/series/${article.seriesSlug}`}
            navigate={navigate}
            className="series-label"
          >
            {article.seriesTitle} · часть {article.episode}
          </Link>
        )}
        <h2>
          <Link to={`/story/${article.slug}`} navigate={navigate}>
            {article.title}
          </Link>
        </h2>
        <p>{article.excerpt}</p>
        {article.percent > 0 && (
          <div
            className="progress-track"
            aria-label={`Прочитано ${article.percent}%`}
          >
            <span style={{ width: `${article.percent}%` }} />
          </div>
        )}
        <div className="card-actions">
          <Link
            className="accent-button"
            to={`/story/${article.slug}`}
            navigate={navigate}
          >
            {article.percent > 0 && article.percent < 100
              ? `Продолжить · ${article.percent}%`
              : "Читать историю"}
          </Link>
          <button
            aria-label={`Нравится: ${article.likeCount || 0}`}
            aria-pressed={Boolean(article.liked)}
            onClick={() => toggleAction(article, "like")}
          >
            ♥ {article.likeCount || 0}
          </button>
          <button
            aria-pressed={Boolean(article.bookmarked)}
            onClick={() => toggleAction(article, "bookmark")}
          >
            {article.bookmarked ? "✓ Закладка" : "+ Закладка"}
          </button>
        </div>
      </div>
    </article>
  );
  return (
    <div className={`app theme-${theme === "light" ? "light" : "dark"}`}>
      <a href="#main" className="skip-link">
        Перейти к содержимому
      </a>
      <header className="site-header">
        <Link to="/" navigate={navigate} className="logo">
          <span>АРХИВНЫЕ ИСТОРИИ</span>
          <strong>Тёмный архив</strong>
        </Link>
        <nav className="nav" aria-label="Главная навигация">
          <Link
            to="/"
            navigate={navigate}
            aria-current={path === "/" ? "page" : undefined}
          >
            Истории
          </Link>
          <Link
            to="/series"
            navigate={navigate}
            aria-current={path.startsWith("/series") ? "page" : undefined}
          >
            Серии
          </Link>
          <Link
            to="/library"
            navigate={navigate}
            aria-current={path === "/library" ? "page" : undefined}
          >
            Моя библиотека
          </Link>
          <button
            aria-label={
              theme === "dark"
                ? "Включить светлую тему"
                : "Включить тёмную тему"
            }
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            {theme === "light" ? "☾" : "☀"}
          </button>
          {user ? (
            <>
              <button onClick={logout}>Выйти · {user.name}</button>
              {user.role === "admin" && (
                <Link
                  className="accent-button"
                  to="/author"
                  navigate={navigate}
                >
                  Кабинет автора
                </Link>
              )}
            </>
          ) : (
            <Link to="/login" navigate={navigate}>
              Войти
            </Link>
          )}
        </nav>
      </header>
      <main id="main" className="container">
        {loading ? (
          <p className="empty-state" role="status">
            Открываем архив…
          </p>
        ) : (
          <>
            {!online && (
              <div className="service-banner" role="status">
                Архив открыт для чтения. Вход и обсуждения временно недоступны.
                <button onClick={refresh}>Проверить соединение</button>
              </div>
            )}
            {path === "/" && (
              <>
                <section className="hero">
                  <span className="eyebrow">рассказы Артёма</span>
                  <h1>
                    Есть истории,
                    <br />
                    которые не отпускают.
                  </h1>
                  <p>
                    Забытые деревни. Советские экспедиции. Старые поверья, в
                    которых оказалось слишком много правды.
                  </p>
                  <div className="hero-actions">
                    <a href="#stories" className="accent-button">
                      Открыть архив ↓
                    </a>
                    <a
                      href="https://dzen.ru/dfago2005"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Читать в Дзене ↗
                    </a>
                  </div>
                </section>
                {recent && (
                  <section className="continue-card">
                    <div>
                      <span className="eyebrow">вы уже начали</span>
                      <h2>{recent.title}</h2>
                      <span className="muted">Прочитано {recent.percent}%</span>
                    </div>
                    <Link
                      to={`/story/${recent.slug}`}
                      navigate={navigate}
                      className="accent-button"
                    >
                      Продолжить чтение →
                    </Link>
                  </section>
                )}
                <section id="stories">
                  <div className="section-heading">
                    <div>
                      <h2>Истории из архива</h2>
                      <p className="muted">
                        Отдельные рассказы и новые части серий.
                      </p>
                    </div>
                    <label className="search-label">
                      <span className="sr-only">Поиск по историям</span>
                      <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Найти историю…"
                      />
                    </label>
                  </div>
                  {filtered.length ? (
                    <div className="article-grid">{filtered.map(card)}</div>
                  ) : (
                    <div className="empty-state">
                      <h3>Ничего не нашлось</h3>
                      <p>
                        Попробуйте другое название или уберите часть запроса.
                      </p>
                    </div>
                  )}
                </section>
              </>
            )}
            {path.startsWith("/story/") && (
              <Reader
                slug={path.slice(7)}
                online={online}
                fallbackArticles={articles}
                user={user}
                navigate={navigate}
                notify={notify}
                toggleAction={toggleAction}
                onProgress={updateProgress}
                revision={revision}
              />
            )}
            {path === "/series" && (
              <section>
                <span className="eyebrow">истории с продолжением</span>
                <h1>Серии архива</h1>
                <p className="muted">Все части собраны в порядке чтения.</p>
                {catalog.series.length ? (
                  <div className="series-grid">
                    {catalog.series.map((s) => (
                      <Link
                        key={s.id}
                        className="series-card"
                        to={`/series/${s.slug}`}
                        navigate={navigate}
                      >
                        <span className="eyebrow">{s.episodeCount} частей</span>
                        <h2>{s.title}</h2>
                        <p>{s.description}</p>
                        <span>Открыть серию →</span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <h2>Серии скоро появятся</h2>
                    <p>Пока можно выбрать отдельный рассказ в архиве.</p>
                    <Link to="/" navigate={navigate}>
                      К историям →
                    </Link>
                  </div>
                )}
              </section>
            )}
            {seriesSlug && (
              <section>
                <Link to="/series" navigate={navigate} className="back-link">
                  ← Все серии
                </Link>
                <h1>{series?.title || "Серия не найдена"}</h1>
                <p className="muted">{series?.description}</p>
                <div className="article-grid">{seriesArticles.map(card)}</div>
              </section>
            )}
            {path === "/library" && (
              <section>
                <span className="eyebrow">сохранённое и начатое</span>
                <h1>Моя библиотека</h1>
                <p className="muted">
                  {user
                    ? "Закладки и место чтения доступны на любом устройстве после входа."
                    : "Закладки и место чтения сохраняются на этом устройстве. Войдите, чтобы синхронизировать закладки."}
                </p>
                {myLibrary.length ? (
                  <div className="article-grid">{myLibrary.map(card)}</div>
                ) : (
                  <div className="empty-state">
                    <h2>Здесь будут ваши истории</h2>
                    <p>Добавьте рассказ в закладки или начните читать.</p>
                    <Link to="/" navigate={navigate}>
                      Выбрать историю →
                    </Link>
                  </div>
                )}
              </section>
            )}
            {path === "/login" && (
              <Login
                online={online}
                user={user}
                signedIn={signedIn}
                navigate={navigate}
                notify={notify}
              />
            )}
            {path === "/author" &&
              (user?.role === "admin" ? (
                <Admin
                  notify={notify}
                  refresh={async () => {
                    await refresh();
                    setRevision((v) => v + 1);
                  }}
                  navigate={navigate}
                />
              ) : (
                <section className="empty-state">
                  <h1>Кабинет автора</h1>
                  <p>Войдите под аккаунтом автора.</p>
                  <Link to="/login" navigate={navigate}>
                    Войти
                  </Link>
                </section>
              ))}
            {path === "/feedback" && (
              <Feedback
                user={user}
                online={online}
                notify={notify}
                navigate={navigate}
              />
            )}
            {path === "/setup" && (
              <OwnerSetup
                online={online}
                navigate={navigate}
                onCreated={async (nextUser) => {
                  await signedIn(nextUser);
                  navigate("/author");
                  notify("Кабинет автора создан. Можно добавлять истории.");
                }}
              />
            )}
            {![
              "/",
              "/series",
              "/library",
              "/login",
              "/author",
              "/feedback",
              "/setup",
            ].includes(path) &&
              !path.startsWith("/story/") &&
              !seriesSlug && (
                <section className="empty-state">
                  <h1>Такого дела в архиве нет</h1>
                  <Link to="/" navigate={navigate}>
                    На главную
                  </Link>
                </section>
              )}
          </>
        )}
      </main>
      <footer className="footer">
        <div>
          <strong>Тёмный архив</strong>
          <span>
            Авторские мистические рассказы · © {new Date().getFullYear()}
          </span>
        </div>
        <div>
          <Link to="/feedback" navigate={navigate}>
            Написать автору
          </Link>
          <a
            href="https://dzen.ru/dfago2005"
            target="_blank"
            rel="noopener noreferrer"
          >
            Канал в Дзене ↗
          </a>
          {readLocal("articles", null) && (
            <button
              onClick={() =>
                downloadJSON("dark-archive-device-backup.json", {
                  articles: readLocal("articles", []),
                })
              }
            >
              Скачать статьи с устройства
            </button>
          )}
        </div>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="Закрыть уведомление" onClick={() => setToast("")}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
function Login({ online, user, signedIn, navigate, notify }) {
  const [register, setRegister] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", name: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api(register ? "/auth/register" : "/auth/login", {
        method: "POST",
        body: form,
      });
      await signedIn(result.user);
      notify(register ? "Добро пожаловать в архив." : "Вы вошли в архив.");
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  if (user)
    return (
      <section className="empty-state">
        <h1>Вы уже вошли, {user.name}</h1>
        <Link to="/library" navigate={navigate}>
          Открыть библиотеку
        </Link>
      </section>
    );
  return (
    <section className="form-card auth-card">
      <span className="eyebrow">свой уголок в архиве</span>
      <h1>{register ? "Регистрация" : "С возвращением"}</h1>
      <p className="muted">
        Чтобы сохранять истории, продолжать чтение на другом устройстве и
        обсуждать прочитанное.
      </p>
      <div className="auth-tabs">
        <button
          aria-pressed={!register}
          onClick={() => {
            setRegister(false);
            setError("");
          }}
        >
          Вход
        </button>
        <button
          aria-pressed={register}
          onClick={() => {
            setRegister(true);
            setError("");
          }}
        >
          Регистрация
        </button>
      </div>
      {!online ? (
        <p>Вход временно недоступен. Истории можно читать без регистрации.</p>
      ) : (
        <form onSubmit={submit}>
          {register && (
            <label>
              Как к вам обращаться
              <input
                autoComplete="nickname"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                minLength={2}
                maxLength={60}
                required
              />
            </label>
          )}
          <label>
            Логин
            <input
              autoComplete="username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              minLength={3}
              maxLength={40}
              pattern="[a-zA-Zа-яА-ЯёЁ0-9_.\-]+"
              required
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              minLength={10}
              maxLength={128}
              required
            />
          </label>
          <p className="field-help">
            Логин: от 3 символов. Пароль: от 10 символов.
          </p>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button className="accent-button" disabled={busy}>
            {busy ? "Подождите…" : register ? "Создать аккаунт" : "Войти"}
          </button>
        </form>
      )}
    </section>
  );
}
function Feedback({ user, online, notify, navigate }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  async function send(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/feedback", { method: "POST", body: { text } });
      setSent(true);
      setText("");
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="form-card">
      <span className="eyebrow">обратная связь</span>
      <h1>Написать Артёму</h1>
      <p className="muted">
        Предложить тему, поделиться своей историей или сообщить об ошибке.
      </p>
      {sent ? (
        <p role="status">
          Сообщение сохранено. Артём увидит его в кабинете автора.
        </p>
      ) : !online ? (
        <p>
          Форма временно недоступна. Можно оставить комментарий на{" "}
          <a
            href="https://dzen.ru/dfago2005"
            target="_blank"
            rel="noopener noreferrer"
          >
            канале в Дзене
          </a>
          .
        </p>
      ) : !user ? (
        <p>
          <Link to="/login" navigate={navigate}>
            Войдите
          </Link>
          , чтобы отправить сообщение.
        </p>
      ) : (
        <form onSubmit={send}>
          <label>
            Ваше сообщение
            <textarea
              rows={7}
              minLength={10}
              maxLength={4000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
            />
          </label>
          <button disabled={busy} className="accent-button">
            {busy ? "Отправляем…" : "Отправить автору"}
          </button>
        </form>
      )}
    </section>
  );
}
createRoot(document.getElementById("root")).render(<App />);
