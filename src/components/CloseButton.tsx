import { CloseIcon } from './CloseIcon';

interface Props {
  onClick: () => void;
  label?: string;
  className?: string;
}

/** Shared close control for dialogs and content panels. */
export function CloseButton({ onClick, label = '关闭', className = '' }: Props) {
  return <button type="button" className={`ui-close-button ${className}`.trim()} aria-label={label} title="关闭" onClick={onClick}>
    <CloseIcon />
  </button>;
}
