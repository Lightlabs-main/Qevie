import React, { useState } from "react";

/**
 * Copy a string to the clipboard with a graceful fallback. The async Clipboard
 * API needs a secure context and document focus; when it's unavailable or
 * rejects (older webviews, embedded contexts), fall back to a hidden textarea +
 * execCommand so the button never silently does nothing.
 */
async function copyText(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through to the textarea fallback */
  }
  try {
    const el = document.createElement("textarea");
    el.value = value;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.focus();
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({
  value,
  className = "btn-ghost",
  label = "Copy",
}: {
  value: string;
  className?: string;
  label?: string;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);

  const onClick = (): void => {
    void copyText(value).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <button type="button" className={className} onClick={onClick}>
      {copied ? "✓ Copied" : label}
    </button>
  );
}
