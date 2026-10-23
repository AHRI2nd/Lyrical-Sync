import { useEffect, useRef, type RefObject } from 'react';
import { isComposingKeyEvent } from '../utils/keybindings';

interface Scope { element: HTMLElement; priority: number }
const scopes: Scope[] = [];
const madeInert = new Set<HTMLElement>();
function topScope() {
  return scopes.filter(s => s.element.isConnected).reduce<Scope | undefined>((top, scope) => {
    if (!top || scope.priority > top.priority) return scope;
    if (scope.priority === top.priority && top.element.compareDocumentPosition(scope.element) & Node.DOCUMENT_POSITION_FOLLOWING) return scope;
    return top;
  }, undefined);
}
function updateBackground() {
  for (const element of madeInert) element.removeAttribute('inert');
  madeInert.clear();
  let current = topScope()?.element;
  while (current?.parentElement && current !== document.body) {
    for (const sibling of current.parentElement.children) {
      if (sibling !== current && sibling instanceof HTMLElement && !sibling.hasAttribute('inert')) {
        sibling.setAttribute('inert', ''); madeInert.add(sibling);
      }
    }
    current = current.parentElement;
  }
}
function focusable(element: HTMLElement) {
  return [...element.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]')].filter(node =>
    node.tabIndex >= 0 && !node.matches(':disabled') && !node.closest('[hidden],[inert]') &&
    getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden');
}
function focusInside(element: HTMLElement) {
  const preferred = element.querySelector<HTMLElement>('[data-modal-initial-focus]');
  (preferred ?? focusable(element)[0] ?? element).focus({ preventScroll: true });
}

/** Own focus and background isolation only while this is the topmost modal. */
export function useModalFocus(ref: RefObject<HTMLElement | null>, onEscape?: () => void, enabled = true, priority = 50) {
  const escape = useRef(onEscape); escape.current = onEscape;
  const wasEnabled = useRef(false);
  const opener = useRef<Element | null>(null);
  // Capture before descendant effects can move focus to their initial heading.
  if (enabled && !wasEnabled.current) opener.current = document.activeElement;
  wasEnabled.current = enabled;
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    const previous = opener.current;
    const scope = { element, priority }; scopes.push(scope); updateBackground();
    if (topScope() === scope && !element.contains(document.activeElement)) focusInside(element);
    const onFocus = (event: FocusEvent) => {
      if (topScope() === scope && !element.contains(event.target as Node)) focusInside(element);
    };
    const onKey = (event: KeyboardEvent) => {
      if (topScope() !== scope || event.defaultPrevented || isComposingKeyEvent(event)) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); escape.current?.();
      } else if (event.key === 'Tab') {
        const nodes = focusable(element); const index = nodes.indexOf(document.activeElement as HTMLElement);
        if (index < 0 || (!event.shiftKey && index === nodes.length - 1) || (event.shiftKey && index === 0)) {
          event.preventDefault(); (event.shiftKey ? nodes[nodes.length - 1] ?? element : nodes[0] ?? element).focus();
        }
      }
    };
    document.addEventListener('focusin', onFocus);
    document.addEventListener('keydown', onKey);
    return () => {
      // Passive cleanup may run after React has detached the dialog.
      const owned = topScope() === scope || !topScope();
      scopes.splice(scopes.indexOf(scope), 1); updateBackground();
      document.removeEventListener('focusin', onFocus); document.removeEventListener('keydown', onKey);
      if (owned && previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
      const next = topScope();
      if (next && !next.element.contains(document.activeElement)) focusInside(next.element);
    };
  }, [ref, enabled, priority]);
}
