import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  formatDate,
  guestProgress,
  writeLocal,
  readLocal,
} from "../api.js";
import { Link } from "./Link.jsx";

function imageBlock(block) {
  return block.match(/^!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)$/);
}

function inlineLinks(text) {
  return text
    .split(/(\[[^\]\n]+\]\(https:\/\/[^\s)]+\))/g)
    .map((part, index) => {
      const link = part.match(/^\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)$/);
      return link ? (
        <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">
          {link[1]}
        </a>
      ) : (
        part
      );
    });
}

export default function Reader({
  slug,
  online,
  fallbackArticles,
  user,
  navigate,
  notify,
  onProgress,
  toggleAction,
  revision,
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [fontSize, setFontSize] = useState(() =>
    Math.min(28, Math.max(18, Number(readLocal("archive:font", 20)) || 20)),
  );
  const [progress, setProgress] = useState(0);
  const bodyRef = useRef(null);
  const positionRef = useRef(null);
  const touchedRef = useRef(false);
  const [resume, setResume] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    setComment("");
    positionRef.current = null;
    touchedRef.current = false;
    async function load() {
      try {
        const result = online
          ? await api(`/articles/${encodeURIComponent(slug)}`, {
              signal: controller.signal,
            })
          : (() => {
              const article = fallbackArticles.find((a) => a.slug === slug);
              if (!article) throw new Error("История не найдена.");
              return { article, comments: [], episodes: [], progress: null };
            })();
        if (controller.signal.aborted) return;
        const saved = user ? result.progress : guestProgress(result.article.id);
        setResume(saved?.percent > 0 && saved.percent < 100 ? saved : null);
        setProgress(saved?.percent || 0);
        setData(result);
      } catch (error) {
        if (error.name !== "AbortError") setError(error.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [slug, online, user?.id, revision]);

  const blocks = useMemo(
    () =>
      data?.article.content
        .split(/\n\s*\n/)
        .map((s) => s.trim())
        .filter(Boolean) || [],
    [data?.article.content],
  );
  useEffect(() => {
    if (!data) return;
    const articleId = data.article.id;
    let timer;
    let saving = false;
    let lastSaved = "";
    const calculate = () => {
      const container = bodyRef.current;
      if (!container) return;
      const elements = [...container.querySelectorAll("[data-paragraph]")];
      const first = elements.findIndex(
        (element) => element.getBoundingClientRect().bottom > 110,
      );
      const rect = container.getBoundingClientRect();
      const percent = Math.round(
        Math.min(
          100,
          Math.max(
            0,
            ((window.innerHeight - rect.top) / Math.max(1, rect.height)) * 100,
          ),
        ),
      );
      positionRef.current = {
        paragraph: Math.max(0, first < 0 ? elements.length - 1 : first),
        percent,
      };
      if (touchedRef.current) setProgress(percent);
    };
    const save = async (keepalive = false) => {
      if (!touchedRef.current || !positionRef.current) return;
      const position = positionRef.current;
      const key = JSON.stringify(position);
      if (!keepalive && (key === lastSaved || saving)) return;
      if (user && online) {
        if (!keepalive) saving = true;
        try {
          await api(`/articles/${articleId}/progress`, {
            method: "PUT",
            body: position,
            keepalive,
          });
          lastSaved = key;
          onProgress(data.article, position);
        } catch {
          if (!keepalive)
            notify("Не удалось сохранить место чтения. Проверьте соединение.");
        } finally {
          saving = false;
        }
      } else {
        writeLocal(`archive:progress:${articleId}`, {
          ...position,
          lastReadAt: new Date().toISOString(),
        });
        lastSaved = key;
      }
    };
    const scroll = () => {
      touchedRef.current = true;
      calculate();
      clearTimeout(timer);
      timer = setTimeout(() => save(), 900);
    };
    const hide = () => {
      if (document.visibilityState === "hidden") {
        clearTimeout(timer);
        save(true);
      }
    };
    const leave = () => {
      clearTimeout(timer);
      save(true);
    };
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hide);
    // Do not overwrite the saved position merely by opening a story at the top.
    calculate();
    return () => {
      clearTimeout(timer);
      save(true);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [data?.article.id, user?.id, online, slug]);

  function continueReading() {
    const index = Math.min(resume.paragraph, blocks.length - 1);
    bodyRef.current
      ?.querySelector(`[data-paragraph="${index}"]`)
      ?.scrollIntoView({ behavior: "instant", block: "start" });
    touchedRef.current = true;
    setResume(null);
  }
  async function addComment(event) {
    event.preventDefault();
    if (!user) {
      navigate("/login");
      return;
    }
    setSending(true);
    try {
      const result = await api(`/articles/${data.article.id}/comments`, {
        method: "POST",
        body: { text: comment },
      });
      setData((previous) => ({
        ...previous,
        comments: [...previous.comments, result.comment],
      }));
      setComment("");
    } catch (error) {
      notify(error.message);
    } finally {
      setSending(false);
    }
  }
  async function deleteComment(id) {
    if (!window.confirm("Удалить этот комментарий?")) return;
    try {
      await api(`/comments/${id}`, { method: "DELETE" });
      setData((previous) => ({
        ...previous,
        comments: previous.comments.filter((c) => c.id !== id),
      }));
    } catch (error) {
      notify(error.message);
    }
  }
  async function action(kind) {
    const changed = await toggleAction(data.article, kind);
    if (changed)
      setData((previous) => ({
        ...previous,
        article: { ...previous.article, ...changed },
      }));
  }
  if (loading)
    return (
      <p role="status" className="empty-state">
        Открываем историю…
      </p>
    );
  if (error)
    return (
      <section className="empty-state">
        <h1>{error}</h1>
        <Link to="/" navigate={navigate}>
          Вернуться в архив
        </Link>
      </section>
    );
  const { article, episodes, comments } = data;
  const coverInContent = blocks.some(
    (block) => imageBlock(block)?.[2] === article.cover,
  );
  const index = episodes.findIndex((e) => e.id === article.id);
  return (
    <article className="article-page">
      <Link className="back-link" to="/" navigate={navigate}>
        ← Все истории
      </Link>
      <div className="article-shell">
        {article.cover && !coverInContent && (
          <img className="article-cover" src={article.cover} alt="" />
        )}
        <div className="article-content">
          <div className="article-meta">
            <span>{formatDate(article.date)}</span>
            {article.seriesTitle && (
              <Link to={`/series/${article.seriesSlug}`} navigate={navigate}>
                {article.seriesTitle} · часть {article.episode}
              </Link>
            )}
            {article.status === "draft" && (
              <span className="badge">Черновик</span>
            )}
          </div>
          <h1>{article.title}</h1>
          <div className="reader-tools" aria-label="Настройки чтения">
            <span>Размер текста</span>
            <button
              aria-label="Уменьшить текст"
              disabled={fontSize <= 18}
              onClick={() => {
                setFontSize(fontSize - 2);
                writeLocal("archive:font", fontSize - 2);
              }}
            >
              А−
            </button>
            <button
              aria-label="Увеличить текст"
              disabled={fontSize >= 28}
              onClick={() => {
                setFontSize(fontSize + 2);
                writeLocal("archive:font", fontSize + 2);
              }}
            >
              А+
            </button>
            <span className="reading-status">Прочитано {progress}%</span>
          </div>
          {resume && (
            <div className="resume-banner">
              <span>Вы остановились на {resume.percent}% истории.</span>
              <button className="accent-button" onClick={continueReading}>
                Продолжить чтение
              </button>
              <button onClick={() => setResume(null)}>Читать сначала</button>
            </div>
          )}
          <div className="reader-text" ref={bodyRef} style={{ fontSize }}>
            {blocks.map((block, number) => {
              const image = imageBlock(block);
              if (image)
                return (
                  <figure data-paragraph={number} key={number}>
                    <img loading="lazy" src={image[2]} alt={image[1]} />
                    <figcaption>{image[1]}</figcaption>
                  </figure>
                );
              if (block.startsWith("## "))
                return (
                  <h2 data-paragraph={number} key={number}>
                    {inlineLinks(block.slice(3))}
                  </h2>
                );
              return (
                <p data-paragraph={number} key={number}>
                  {inlineLinks(block)}
                </p>
              );
            })}
          </div>
          {article.sourceUrl && (
            <p>
              <a
                href={article.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Эта история в Дзене ↗
              </a>
            </p>
          )}
          {episodes.length > 0 && (
            <nav className="episode-nav" aria-label="Части серии">
              {index > 0 && (
                <Link
                  to={`/story/${episodes[index - 1].slug}`}
                  navigate={navigate}
                >
                  ← Часть {episodes[index - 1].episode}
                </Link>
              )}
              <Link to={`/series/${article.seriesSlug}`} navigate={navigate}>
                Все части
              </Link>
              {index >= 0 && index < episodes.length - 1 && (
                <Link
                  className="accent-button"
                  to={`/story/${episodes[index + 1].slug}`}
                  navigate={navigate}
                >
                  Часть {episodes[index + 1].episode} →
                </Link>
              )}
            </nav>
          )}
          <div className="social-panel">
            <button aria-pressed={article.liked} onClick={() => action("like")}>
              ♥ {article.likeCount || 0}
            </button>
            <button
              aria-pressed={article.bookmarked}
              onClick={() => action("bookmark")}
            >
              {article.bookmarked ? "✓ В закладках" : "+ В закладки"}
            </button>
          </div>
          <section className="comments">
            <h2>Обсуждение</h2>
            {!online && (
              <p className="muted">Обсуждение временно недоступно.</p>
            )}
            {online && (
              <>
                <div className="comment-list">
                  {!comments.length && (
                    <p className="muted">
                      Здесь ещё тихо. Можно оставить первый комментарий.
                    </p>
                  )}
                  {comments.map((c) => (
                    <div className="comment" key={c.id}>
                      <div className="comment-header">
                        <strong>{c.author}</strong>
                        <span>{formatDate(c.date)}</span>
                        {(user?.id === c.userId || user?.role === "admin") && (
                          <button onClick={() => deleteComment(c.id)}>
                            Удалить
                          </button>
                        )}
                      </div>
                      <p>{c.text}</p>
                    </div>
                  ))}
                </div>
                {user ? (
                  <form onSubmit={addComment}>
                    <label htmlFor="comment">Ваш комментарий</label>
                    <textarea
                      id="comment"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={4}
                      minLength={2}
                      maxLength={2000}
                      required
                    />
                    <button className="accent-button" disabled={sending}>
                      {sending ? "Отправляем…" : "Оставить комментарий"}
                    </button>
                  </form>
                ) : (
                  <p className="muted">
                    <Link to="/login" navigate={navigate}>
                      Войдите
                    </Link>
                    , чтобы присоединиться к обсуждению.
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </article>
  );
}
