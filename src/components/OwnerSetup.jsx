import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { Link } from "./Link.jsx";

export default function OwnerSetup({ online, onCreated, navigate }) {
  const [form, setForm] = useState({
    token: "",
    username: "dfago",
    name: "Артём",
    password: "",
    confirmation: "",
  });
  const [enabled, setEnabled] = useState(null);
  const [linkToken, setLinkToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get(
      "setup",
    );
    if (token) {
      setLinkToken(true);
      setForm((previous) => ({ ...previous, token }));
      // The fragment stays out of HTTP requests and is removed from this history entry.
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
  }, []);
  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    api("/owner/setup", { signal: controller.signal })
      .then((result) => setEnabled(result.enabled))
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [online]);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (form.password !== form.confirmation) {
      setError("Пароли не совпадают.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { confirmation, ...body } = form;
      const result = await api("/owner/setup", { method: "POST", body });
      setForm((previous) => ({
        ...previous,
        token: "",
        password: "",
        confirmation: "",
      }));
      await onCreated(result.user);
    } catch (cause) {
      setError(cause.message);
      if (cause.status === 404) setEnabled(false);
      if (cause.status === 409) {
        try {
          setEnabled((await api("/owner/setup")).enabled);
        } catch {}
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="form-card auth-card">
      <span className="eyebrow">для владельца архива</span>
      <h1>Ваш кабинет автора</h1>
      {!online ? (
        <p>Не удалось связаться с архивом. Повторите позже.</p>
      ) : enabled === false ? (
        <>
          <p>
            Первоначальная настройка закрыта: кабинет уже создан или срок ссылки
            истёк.
          </p>
          <Link to="/login" navigate={navigate}>
            Войти в архив →
          </Link>
        </>
      ) : enabled === null ? (
        <p role="status">{error || "Проверяем ссылку…"}</p>
      ) : (
        <>
          <p className="muted">
            Задайте логин и пароль. После создания аккаунта откроется кабинет
            для публикации историй и управления сериями.
          </p>
          <form onSubmit={submit}>
            {!linkToken && (
              <label>
                Код настройки
                <input
                  type="password"
                  autoComplete="off"
                  required
                  maxLength={128}
                  value={form.token}
                  onChange={(event) =>
                    setForm({ ...form, token: event.target.value })
                  }
                />
              </label>
            )}
            <label>
              Как к вам обращаться
              <input
                autoComplete="nickname"
                required
                minLength={2}
                maxLength={60}
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </label>
            <label>
              Логин
              <input
                autoComplete="username"
                required
                minLength={3}
                maxLength={40}
                pattern="[a-zA-Zа-яА-ЯёЁ0-9_.\-]+"
                value={form.username}
                onChange={(event) =>
                  setForm({ ...form, username: event.target.value })
                }
              />
            </label>
            <label>
              Пароль
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                maxLength={128}
                value={form.password}
                onChange={(event) =>
                  setForm({ ...form, password: event.target.value })
                }
              />
            </label>
            <label>
              Повторите пароль
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                maxLength={128}
                value={form.confirmation}
                onChange={(event) =>
                  setForm({ ...form, confirmation: event.target.value })
                }
              />
            </label>
            <p className="field-help">
              Не менее 10 символов. Сохраните пароль в своём менеджере паролей.
            </p>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button className="accent-button" disabled={busy}>
              {busy ? "Создаём кабинет…" : "Создать кабинет автора"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
