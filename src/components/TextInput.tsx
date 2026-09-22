import {
  forwardRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { Icon } from "./Icon";
import "./FormControls.css";

interface Props extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "prefix"
> {
  onChange: (value: string) => void;
  leading?: ReactNode;
}

export const TextInput = forwardRef<HTMLInputElement, Props>(function TextInput(
  { onChange, className = "", leading, type = "text", disabled, ...props },
  ref,
) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={`ui-text-field ${className}`}
      data-disabled={disabled || undefined}
    >
      {leading && <span className="ui-text-field-leading">{leading}</span>}
      <input
        {...props}
        ref={ref}
        type={type === "password" && revealed ? "text" : type}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {type === "password" && (
        <button
          type="button"
          className="ui-input-accessory"
          disabled={disabled}
          aria-label={revealed ? "隐藏密钥" : "显示密钥"}
          aria-pressed={revealed}
          onClick={() => setRevealed((value) => !value)}
        >
          <Icon name={revealed ? "eye-off" : "eye"} size={16} />
        </button>
      )}
    </span>
  );
});

/** Multiline input shares the same field chrome and native editing behavior. */
export const TextArea = forwardRef<HTMLTextAreaElement, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> & { onChange: (value: string) => void }>(function TextArea(
  { onChange, className = '', disabled, ...props }, ref,
) {
  return <span className={`ui-text-field ui-text-field--multiline ${className}`} data-disabled={disabled || undefined}><textarea {...props} ref={ref} disabled={disabled} onChange={event => onChange(event.target.value)} /></span>;
});
