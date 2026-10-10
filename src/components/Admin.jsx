import React, { useEffect, useRef, useState } from "react";
import { api, readLocal, downloadJSON, formatDate } from "../api.js";
const blank = () => ({
  title: "",
  excerpt: "",
  cover: "",
  content: "",
  status: "draft",
  date: new Date().toISOString().slice(0, 10),
  seriesId: "",
  episode: "",
  sourceUrl: "",
});
export default function Admin({ notify, refresh, navigate }) {
  const [catalog, setCatalog] = useState({
    articles: [],
    series: [],
    feedback: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [seriesTitle, setSeriesTitle] = useState("");
  const [seriesDescription, setSeriesDescription] = useState("");
  const [importPreview, setImportPreview] = useState(null);
  const fileRef = useRef(null);
  async function load() {
    try {
      setCatalog(await api("/admin/catalog"));
      setError("");
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  const change = (key, value) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api(
        editingId ? `/admin/articles/${editingId}` : "/admin/articles",
        { method: editingId ? "PUT" : "POST", body: form },
      );
      setEditingId(null);
      setForm(blank());
      await load();
      await refresh();
      notify("Статья сохранена.");
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(article) {
    if (
      !window.confirm(
        `Удалить «${article.title}» и её комментарии? Это действие нельзя отменить.`,
      )
    )
      return;
    setBusy(true);
    try {
      await api(`/admin/articles/${article.id}`, { method: "DELETE" });
      if (editingId === article.id) {
        setEditingId(null);
        setForm(blank());
      }
      await load();
      await refresh();
      notify("Статья удалена.");
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function createSeries(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/admin/series", {
        method: "POST",
        body: { title: seriesTitle, description: seriesDescription },
      });
      setSeriesTitle("");
      setSeriesDescription("");
      await load();
      notify("Серия создана. Теперь можно добавить в неё части.");
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }
  function previewImport(data) {
    const articles = Array.isArray(data) ? data : data.articles;
    if (
      !Array.isArray(articles) ||
      !articles.length ||
      articles.length > 100 ||
      articles.some(
        (a) =>
          !a || typeof a.title !== "string" || typeof a.content !== "string",
      )
    )
      throw new Error(
        "В файле должны быть от 1 до 100 статей с заголовком и текстом.",
      );
    setImportPreview(articles);
  }
  async function readImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024)
        throw new Error("Файл должен быть меньше 2 МБ.");
      previewImport(JSON.parse(await file.text()));
    } catch (error) {
      notify(error.message);
    } finally {
      event.target.value = "";
    }
  }
  async function importArticles() {
    setBusy(true);
    try {
      const result = await api("/admin/import", {
        method: "POST",
        body: { articles: importPreview },
      });
      setImportPreview(null);
      await load();
      await refresh();
      notify(
        `Добавлено черновиков: ${result.imported}. Уже были в архиве: ${result.skipped}.`,
      );
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <p className="empty-state" role="status">
        Открываем кабинет автора…
      </p>
    );
  if (error)
    return (
      <section className="empty-state">
        <p role="alert">{error}</p>
        <button onClick={load}>Повторить</button>
      </section>
    );
  return (
    <section>
      <div className="section-heading">
        <div>
          <span className="eyebrow">кабинет автора</span>
          <h1>Управление архивом</h1>
        </div>
        <button
          onClick={() =>
            downloadJSON("dark-archive-backup.json", {
              version: 1,
              articles: catalog.articles,
              series: catalog.series,
            })
          }
        >
          Скачать копию статей
        </button>
      </div>
      <div className="admin-grid">
        <section className="form-card admin-form">
          <h2>{editingId ? "Редактировать статью" : "Новая история"}</h2>
          <form onSubmit={save}>
            <label>
              Заголовок
              <input
                value={form.title}
                onChange={(e) => change("title", e.target.value)}
                minLength={3}
                maxLength={180}
                required
              />
            </label>
            <label>
              Короткое описание
              <textarea
                value={form.excerpt}
                onChange={(e) => change("excerpt", e.target.value)}
                maxLength={1000}
                rows={3}
              />
            </label>
            <label>
              Ссылка на обложку
              <input
                type="url"
                value={form.cover}
                onChange={(e) => change("cover", e.target.value)}
                placeholder="https://…"
              />
            </label>
            <label>
              Текст
              <textarea
                value={form.content}
                onChange={(e) => change("content", e.target.value)}
                minLength={10}
                maxLength={300000}
                rows={16}
                required
              />
            </label>
            <p className="field-help">
              Разделяйте абзацы пустой строкой. Подзаголовок: ## Текст. Фото с
              подписью: ![Подпись](https://ссылка-на-фото).
            </p>
            <label>
              Оригинал в Дзене
              <input
                type="url"
                value={form.sourceUrl}
                onChange={(e) => change("sourceUrl", e.target.value)}
                placeholder="https://dzen.ru/a/…"
              />
            </label>
            <div className="form-row">
              <label>
                Серия
                <select
                  value={form.seriesId || ""}
                  onChange={(e) => {
                    change("seriesId", e.target.value);
                    if (!e.target.value) change("episode", "");
                  }}
                >
                  <option value="">Отдельная история</option>
                  {catalog.series.map((series) => (
                    <option key={series.id} value={series.id}>
                      {series.title}
                    </option>
                  ))}
                </select>
              </label>
              {form.seriesId && (
                <label>
                  Номер части
                  <input
                    type="number"
                    min={1}
                    max={9999}
                    value={form.episode ?? ""}
                    onChange={(e) => change("episode", e.target.value)}
                    required
                  />
                </label>
              )}
            </div>
            <div className="form-row">
              <label>
                Дата
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => change("date", e.target.value)}
                  required
                />
              </label>
              <label>
                Статус
                <select
                  value={form.status}
                  onChange={(e) => change("status", e.target.value)}
                >
                  <option value="draft">Черновик</option>
                  <option value="published">Опубликовано</option>
                </select>
              </label>
            </div>
            <button className="accent-button" disabled={busy}>
              {busy
                ? "Сохраняем…"
                : form.status === "published"
                  ? "Сохранить и опубликовать"
                  : "Сохранить черновик"}
            </button>
            {editingId && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditingId(null);
                  setForm(blank());
                }}
              >
                Закончить редактирование
              </button>
            )}
          </form>
        </section>
        <div className="admin-sidebar">
          <section className="form-card">
            <h2>Все статьи · {catalog.articles.length}</h2>
            <div className="admin-list">
              {catalog.articles.map((article) => (
                <div className="admin-item" key={article.id}>
                  <div>
                    <span className="badge">
                      {article.status === "published"
                        ? "Опубликовано"
                        : "Черновик"}
                    </span>
                    <strong>{article.title}</strong>
                    {article.seriesTitle && (
                      <small>
                        {article.seriesTitle} · часть {article.episode}
                      </small>
                    )}
                  </div>
                  <div className="admin-actions">
                    <button
                      disabled={busy}
                      aria-label={`Редактировать ${article.title}`}
                      onClick={() => {
                        setEditingId(article.id);
                        setForm({
                          ...article,
                          seriesId: article.seriesId || "",
                          episode: article.episode || "",
                        });
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Изменить
                    </button>
                    <button onClick={() => navigate(`/story/${article.slug}`)}>
                      Открыть
                    </button>
                    <button
                      disabled={busy}
                      aria-label={`Удалить ${article.title}`}
                      onClick={() => remove(article)}
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="form-card">
            <h2>Новая серия</h2>
            <form onSubmit={createSeries}>
              <label>
                Название
                <input
                  value={seriesTitle}
                  onChange={(e) => setSeriesTitle(e.target.value)}
                  minLength={3}
                  maxLength={120}
                  required
                />
              </label>
              <label>
                О чём серия
                <textarea
                  value={seriesDescription}
                  onChange={(e) => setSeriesDescription(e.target.value)}
                  maxLength={1000}
                  rows={3}
                />
              </label>
              <button disabled={busy}>Создать серию</button>
            </form>
          </section>
          <section className="form-card">
            <h2>Перенести статьи</h2>
            <p className="muted">
              Из файла или старой версии сайта на этом устройстве. Все новые
              статьи попадут в черновики; совпадающие адреса будут пропущены.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={readImport}
            />
            <div className="card-actions">
              <button disabled={busy} onClick={() => fileRef.current.click()}>
                Выбрать JSON
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  try {
                    previewImport(readLocal("articles", []));
                  } catch (error) {
                    notify(error.message);
                  }
                }}
              >
                Из старой версии
              </button>
            </div>
            {importPreview && (
              <div className="import-preview">
                <p>К переносу: {importPreview.length} статей.</p>
                <ul>
                  {importPreview.slice(0, 5).map((a, i) => (
                    <li key={i}>{a.title}</li>
                  ))}
                </ul>
                <button
                  disabled={busy}
                  className="accent-button"
                  onClick={importArticles}
                >
                  Добавить в черновики
                </button>
                <button disabled={busy} onClick={() => setImportPreview(null)}>
                  Отмена
                </button>
              </div>
            )}
          </section>
          <section className="form-card">
            <h2>Письма читателей</h2>
            {!catalog.feedback.length && (
              <p className="muted">Сообщений пока нет.</p>
            )}
            {catalog.feedback.map((message) => (
              <div className="comment" key={message.id}>
                <strong>{message.name}</strong>
                <span>{formatDate(message.date)}</span>
                <p>{message.text}</p>
              </div>
            ))}
          </section>
        </div>
      </div>
    </section>
  );
}
