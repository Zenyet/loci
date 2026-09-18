import type { ReactNode } from 'react';
import { useEffect, useId } from 'react';
import { CloseIcon } from './CloseIcon';
import './Modal.css';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
  allowOverflow?: boolean;
}

export function Modal({ open, onClose, title, children, width = 420, allowOverflow = false }: Props) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-window"
        style={{ width, overflow: allowOverflow ? 'visible' : 'hidden' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-head">
          <span id={titleId} className="modal-title">{title}</span>
          <button type="button" onClick={onClose} className="modal-close" aria-label="关闭">
            <CloseIcon />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
