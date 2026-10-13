import type { ReactNode } from "react";

export function SettingRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <span>{title}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  disabled?: boolean;
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="settings-switch"
      role="switch"
      disabled={disabled}
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function SettingGroup({
  title,
  children,
  note,
}: {
  title: string;
  children: ReactNode;
  note?: string;
}) {
  return (
    <section className="settings-group" aria-label={title}>
      <h3>{title}</h3>
      <div className="settings-group-body">{children}</div>
      {note && <p className="settings-note">{note}</p>}
    </section>
  );
}

export function SettingNotice({
  children,
  tone = "neutral",
  role = "status",
}: {
  children: ReactNode;
  tone?: "neutral" | "error";
  role?: "status" | "alert";
}) {
  return (
    <p className={`settings-notice settings-notice--${tone}`} role={role}>
      {children}
    </p>
  );
}
