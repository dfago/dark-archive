import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const starterArticles = [
  {
    id: 1,
    title: "Дело №731Б: Мёртвый хутор",
    slug: "delo-731b-mertvyi-hutor",
    excerpt:
      "Старая архивная папка без подписи. Деревня, которой нет на картах. И женщина, не отражавшаяся в зеркале.",
    date: "2026-04-24",
    status: "published",
    cover:
      "https://images.unsplash.com/photo-1516410529446-2c777cb7366d?q=80&w=1600&auto=format&fit=crop",
    content: `В архивах бывшего КГБ на самой пыльной, самой дальней полке до сих пор хранится тонкая папка из серого картона.

На ней нет никаких опознавательных знаков. Только номер, нанесённый карандашом.

Дело №731Б.

Официально его не существует.

Но если открыть первую страницу, становится ясно: кто-то очень старался, чтобы об этом хуторе больше никогда не вспоминали.`
  },
  {
    id: 2,
    title: "Станция, которой нет",
    slug: "stanciya-kotoroi-net",
    excerpt:
      "Ночная смена в метро. Платформа без названия. И поезд, который приходит только для тех, кого уже не ждут.",
    date: "2026-04-22",
    status: "published",
    cover:
      "https://images.unsplash.com/photo-1519608487953-e999c86e7455?q=80&w=1600&auto=format&fit=crop",
    content: `Первый раз я увидел эту станцию в 02:17.

По графику её не было.

На схеме — тоже.

Но поезд замедлил ход, двери раскрылись, и из тёмного тоннеля потянуло холодом, которого в московском метро быть не должно.`
  }
];

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function saveStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function formatDate(date) {
  return new Date(date).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/ё/g, "e")
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function App() {
  const [articles, setArticles] = useState(() => readStorage("articles", starterArticles));
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  const [view, setView] = useState("home");
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [search, setSearch] = useState("");

  const [admin, setAdmin] = useState(() => readStorage("admin", false));
  const [adminLogin, setAdminLogin] = useState({ username: "", password: "" });

  const [users, setUsers] = useState(() => readStorage("users", []));
  const [currentUser, setCurrentUser] = useState(() => readStorage("currentUser", null));
  const [readerLogin, setReaderLogin] = useState({ name: "", password: "" });

  const [likes, setLikes] = useState(() => readStorage("likes", {}));
  const [comments, setComments] = useState(() => readStorage("comments", {}));
  const [collections, setCollections] = useState(() => readStorage("collections", {}));
  const [commentText, setCommentText] = useState("");

  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    title: "",
    excerpt: "",
    cover: "",
    content: "",
    status: "draft"
  });

  useEffect(() => saveStorage("articles", articles), [articles]);
  useEffect(() => localStorage.setItem("theme", theme), [theme]);
  useEffect(() => saveStorage("admin", admin), [admin]);
  useEffect(() => saveStorage("users", users), [users]);
  useEffect(() => saveStorage("currentUser", currentUser), [currentUser]);
  useEffect(() => saveStorage("likes", likes), [likes]);
  useEffect(() => saveStorage("comments", comments), [comments]);
  useEffect(() => saveStorage("collections", collections), [collections]);

  const isDark = theme === "dark";

  const publishedArticles = useMemo(() => {
    return articles
      .filter((article) => article.status === "published")
      .filter((article) =>
        `${article.title} ${article.excerpt}`.toLowerCase().includes(search.toLowerCase())
      )
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [articles, search]);

  const userCollection = currentUser ? collections[currentUser.id] || [] : [];

  function openArticle(article) {
    setSelectedArticle(article);
    setCommentText("");
    setView("article");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setEditingId(null);
    setForm({ title: "", excerpt: "", cover: "", content: "", status: "draft" });
  }

  function handleAdminLogin(event) {
    event.preventDefault();
    if (adminLogin.username === "admin" && adminLogin.password === "1234") {
      setAdmin(true);
      setView("admin");
      return;
    }
    alert("Демо-вход администратора: admin / 1234");
  }

  function handleReaderLogin(event) {
    event.preventDefault();

    const name = readerLogin.name.trim();
    const password = readerLogin.password;

    if (!name) {
      alert("Напиши имя или ник");
      return;
    }

    const existingUser = users.find((user) => user.name.toLowerCase() === name.toLowerCase());

    if (existingUser) {
      if (existingUser.password !== password) {
        alert("Пароль не совпадает");
        return;
      }
      setCurrentUser(existingUser);
    } else {
      const newUser = {
        id: Date.now(),
        name,
        password,
        createdAt: new Date().toISOString()
      };
      setUsers((prev) => [...prev, newUser]);
      setCurrentUser(newUser);
    }

    setReaderLogin({ name: "", password: "" });
    setView("home");
  }

  function needUser(actionName) {
    if (!currentUser) {
      alert(`${actionName} доступны после простой регистрации`);
      setView("reader-login");
      return true;
    }
    return false;
  }

  function toggleLike(articleId) {
    if (needUser("Лайки")) return;

    setLikes((prev) => {
      const articleLikes = prev[articleId] || [];
      const exists = articleLikes.includes(currentUser.id);

      return {
        ...prev,
        [articleId]: exists
          ? articleLikes.filter((id) => id !== currentUser.id)
          : [...articleLikes, currentUser.id]
      };
    });
  }

  function toggleCollection(articleId) {
    if (needUser("Подборки")) return;

    setCollections((prev) => {
      const saved = prev[currentUser.id] || [];
      const exists = saved.includes(articleId);

      return {
        ...prev,
        [currentUser.id]: exists
          ? saved.filter((id) => id !== articleId)
          : [...saved, articleId]
      };
    });
  }

  function addComment(articleId) {
    if (needUser("Комментарии")) return;

    const text = commentText.trim();
    if (!text) return;

    setComments((prev) => ({
      ...prev,
      [articleId]: [
        ...(prev[articleId] || []),
        {
          id: Date.now(),
          author: currentUser.name,
          text,
          date: new Date().toISOString()
        }
      ]
    }));

    setCommentText("");
  }

  function saveArticle(event) {
    event.preventDefault();

    if (!form.title.trim() || !form.content.trim()) {
      alert("Добавь хотя бы заголовок и текст статьи");
      return;
    }

    if (editingId) {
      setArticles((prev) =>
        prev.map((article) =>
          article.id === editingId
            ? {
                ...article,
                title: form.title,
                slug: slugify(form.title),
                excerpt: form.excerpt,
                cover: form.cover,
                content: form.content,
                status: form.status
              }
            : article
        )
      );
    } else {
      setArticles((prev) => [
        {
          id: Date.now(),
          title: form.title,
          slug: slugify(form.title),
          excerpt: form.excerpt,
          cover:
            form.cover ||
            "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=1600&auto=format&fit=crop",
          content: form.content,
          status: form.status,
          date: new Date().toISOString().slice(0, 10)
        },
        ...prev
      ]);
    }

    resetForm();
  }

  function editArticle(article) {
    setEditingId(article.id);
    setForm({
      title: article.title,
      excerpt: article.excerpt,
      cover: article.cover,
      content: article.content,
      status: article.status
    });
    setView("admin");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function deleteArticle(id) {
    if (!confirm("Удалить статью?")) return;
    setArticles((prev) => prev.filter((article) => article.id !== id));
    resetForm();
  }

  return (
    <div className={`app ${isDark ? "theme-dark" : "theme-light"}`}>
      <header className="site-header">
        <button className="logo" onClick={() => setView("home")}>
          <span>АРХИВНЫЕ ИСТОРИИ</span>
          <strong>Тёмный архив</strong>
        </button>

        <nav className="nav">
          <button onClick={() => setTheme(isDark ? "light" : "dark")}>
            {isDark ? "☀ Светлая" : "🌙 Тёмная"}
          </button>
          <button onClick={() => setView("home")}>Статьи</button>

          {currentUser ? (
            <>
              <button onClick={() => setView("collections")}>Моя подборка</button>
              <button onClick={() => setCurrentUser(null)}>Выйти: {currentUser.name}</button>
            </>
          ) : (
            <button onClick={() => setView("reader-login")}>👤 Регистрация</button>
          )}

          {admin ? (
            <>
              <button className="accent-button" onClick={() => setView("admin")}>
                Админка
              </button>
              <button onClick={() => setAdmin(false)}>⎋</button>
            </>
          ) : (
            <button onClick={() => setView("admin-login")}>🔒 Админ</button>
          )}
        </nav>
      </header>

      <main className="container">
        {view === "home" && (
          <>
            <section className="hero">
              <span className="eyebrow">личный блог</span>
              <h1>Мистические истории, секретные папки и дела, которых не было.</h1>
              <p>
                Здесь можно публиковать статьи из Дзена, хранить серии и собирать свою аудиторию
                без зависимости от алгоритмов.
              </p>

              <input
                className="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск по статьям..."
              />
            </section>

            <section className="article-grid">
              {publishedArticles.map((article) => (
                <article className="card" key={article.id}>
                  <img src={article.cover} alt="" />
                  <div className="card-body">
                    <span className="date">📅 {formatDate(article.date)}</span>
                    <h2>{article.title}</h2>
                    <p>{article.excerpt}</p>

                    <div className="card-actions">
                      <button className="accent-button" onClick={() => openArticle(article)}>
                        Читать
                      </button>
                      <button onClick={() => toggleLike(article.id)}>
                        ❤ {(likes[article.id] || []).length}
                      </button>
                      <button onClick={() => toggleCollection(article.id)}>
                        {userCollection.includes(article.id) ? "✓ В подборке" : "＋ Подборка"}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </section>
          </>
        )}

        {view === "article" && selectedArticle && (
          <article className="article-page">
            <button className="back-button" onClick={() => setView("home")}>
              ← Назад к статьям
            </button>

            <div className="article-shell">
              <img className="article-cover" src={selectedArticle.cover} alt="" />

              <div className="article-content">
                <span className="date">📅 {formatDate(selectedArticle.date)}</span>
                <h1>{selectedArticle.title}</h1>

                <div className="reader-text">
                  {selectedArticle.content.split("\n").map((paragraph, index) =>
                    paragraph.trim() ? <p key={index}>{paragraph}</p> : null
                  )}
                </div>

                <div className="social-panel">
                  <button className="accent-button" onClick={() => toggleLike(selectedArticle.id)}>
                    ❤ Нравится: {(likes[selectedArticle.id] || []).length}
                  </button>
                  <button onClick={() => toggleCollection(selectedArticle.id)}>
                    {userCollection.includes(selectedArticle.id)
                      ? "✓ Уже в подборке"
                      : "＋ В мою подборку"}
                  </button>
                </div>

                <section className="comments">
                  <h2>Комментарии</h2>

                  {!currentUser && (
                    <p className="muted">
                      Читать можно без регистрации. Комментарии, лайки и подборки доступны после
                      простого входа.
                    </p>
                  )}

                  <div className="comment-list">
                    {(comments[selectedArticle.id] || []).length === 0 && (
                      <p className="muted">Пока комментариев нет.</p>
                    )}

                    {(comments[selectedArticle.id] || []).map((comment) => (
                      <div className="comment" key={comment.id}>
                        <strong>{comment.author}</strong>
                        <span>{formatDate(comment.date)}</span>
                        <p>{comment.text}</p>
                      </div>
                    ))}
                  </div>

                  <textarea
                    value={commentText}
                    onChange={(event) => setCommentText(event.target.value)}
                    placeholder="Написать комментарий..."
                    rows={4}
                  />

                  <button className="accent-button" onClick={() => addComment(selectedArticle.id)}>
                    Отправить комментарий
                  </button>
                </section>
              </div>
            </div>
          </article>
        )}

        {view === "collections" && currentUser && (
          <section>
            <h1>Моя подборка</h1>

            <div className="article-grid">
              {articles
                .filter((article) => userCollection.includes(article.id))
                .map((article) => (
                  <article className="card" key={article.id}>
                    <img src={article.cover} alt="" />
                    <div className="card-body">
                      <h2>{article.title}</h2>
                      <p>{article.excerpt}</p>
                      <button className="accent-button" onClick={() => openArticle(article)}>
                        Читать
                      </button>
                    </div>
                  </article>
                ))}
            </div>

            {userCollection.length === 0 && (
              <p className="muted">Ты пока ничего не добавил в подборку.</p>
            )}
          </section>
        )}

        {view === "reader-login" && (
          <section className="form-card">
            <h1>Формальная регистрация</h1>
            <p className="muted">
              Нужна только для лайков, комментариев и личных подборок. Для чтения регистрация не
              требуется.
            </p>

            <form onSubmit={handleReaderLogin}>
              <input
                value={readerLogin.name}
                onChange={(event) =>
                  setReaderLogin({ ...readerLogin, name: event.target.value })
                }
                placeholder="Имя или ник"
              />
              <input
                type="password"
                value={readerLogin.password}
                onChange={(event) =>
                  setReaderLogin({ ...readerLogin, password: event.target.value })
                }
                placeholder="Пароль"
              />
              <button className="accent-button">Войти или зарегистрироваться</button>
            </form>
          </section>
        )}

        {view === "admin-login" && (
          <section className="form-card">
            <h1>Вход администратора</h1>
            <p className="muted">Демо-вход: admin / 1234</p>

            <form onSubmit={handleAdminLogin}>
              <input
                value={adminLogin.username}
                onChange={(event) =>
                  setAdminLogin({ ...adminLogin, username: event.target.value })
                }
                placeholder="Логин"
              />
              <input
                type="password"
                value={adminLogin.password}
                onChange={(event) =>
                  setAdminLogin({ ...adminLogin, password: event.target.value })
                }
                placeholder="Пароль"
              />
              <button className="accent-button">Войти</button>
            </form>
          </section>
        )}

        {view === "admin" && admin && (
          <section className="admin-grid">
            <div className="form-card admin-form">
              <h1>Панель администратора</h1>
              <p className="muted">Добавление, черновики и публикация статей.</p>

              <form onSubmit={saveArticle}>
                <input
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                  placeholder="Название статьи"
                />
                <textarea
                  value={form.excerpt}
                  onChange={(event) => setForm({ ...form, excerpt: event.target.value })}
                  placeholder="Короткое описание"
                  rows={3}
                />
                <input
                  value={form.cover}
                  onChange={(event) => setForm({ ...form, cover: event.target.value })}
                  placeholder="Ссылка на обложку"
                />
                <textarea
                  value={form.content}
                  onChange={(event) => setForm({ ...form, content: event.target.value })}
                  placeholder="Текст статьи"
                  rows={14}
                />
                <select
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value })}
                >
                  <option value="draft">Черновик</option>
                  <option value="published">Опубликовано</option>
                </select>

                <button className="accent-button">
                  {editingId ? "Сохранить изменения" : "Добавить статью"}
                </button>
                {editingId && <button type="button" onClick={resetForm}>Новая статья</button>}
              </form>
            </div>

            <div className="form-card">
              <h2>Все статьи</h2>

              <div className="admin-list">
                {articles.map((article) => (
                  <div className="admin-item" key={article.id}>
                    <div>
                      <span className="muted">
                        {article.status === "published" ? "Опубликовано" : "Черновик"}
                      </span>
                      <strong>{article.title}</strong>
                    </div>

                    <div className="admin-actions">
                      <button onClick={() => editArticle(article)}>✎</button>
                      <button onClick={() => deleteArticle(article.id)}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {view === "admin" && !admin && (
          <section className="form-card">
            <h1>Нужен вход администратора</h1>
            <button className="accent-button" onClick={() => setView("admin-login")}>
              Войти
            </button>
          </section>
        )}
      </main>

      <footer className="footer">
        <span>© 2026 Тёмный архив</span>
        <span>robots.txt · sitemap.xml · SEO · мобильная версия</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
