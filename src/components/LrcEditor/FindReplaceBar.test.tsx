// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FindReplaceBar } from './FindReplaceBar';
import { EditorToolsMenu } from './EditorToolsMenu';
import { useI18nStore } from '../../stores/useI18nStore';

afterEach(cleanup);

it('exposes the case-sensitive toggle name and pressed state', () => {
  const onCaseSensitiveToggle = vi.fn();
  const { rerender } = render(<FindReplaceBar findText="text" replaceText="new" caseSensitive={false} matchCount={1} matchPos={0}
    onFindChange={vi.fn()} onReplaceChange={vi.fn()} onCaseSensitiveToggle={onCaseSensitiveToggle} onPrev={vi.fn()}
    onNext={vi.fn()} onReplace={vi.fn()} onReplaceAll={vi.fn()} onClose={vi.fn()}
    findInputRef={{ current: null }} />);
  const label = useI18nStore.getState().t.caseSensitive;
  const toggle = screen.getByRole('button', { name: label });
  expect(toggle.getAttribute('aria-pressed')).toBe('false');

  fireEvent.click(toggle);
  expect(onCaseSensitiveToggle).toHaveBeenCalledOnce();
  rerender(<FindReplaceBar findText="text" replaceText="new" caseSensitive matchCount={1} matchPos={0}
    onFindChange={vi.fn()} onReplaceChange={vi.fn()} onCaseSensitiveToggle={onCaseSensitiveToggle} onPrev={vi.fn()}
    onNext={vi.fn()} onReplace={vi.fn()} onReplaceAll={vi.fn()} onClose={vi.fn()}
    findInputRef={{ current: null }} />);
  expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true');
});

it('does not run find, replace, or close actions for composing keys', () => {
  const onNext = vi.fn();
  const onReplace = vi.fn();
  const onClose = vi.fn();
  render(<FindReplaceBar findText="text" replaceText="new" caseSensitive={false} matchCount={1} matchPos={0}
    onFindChange={vi.fn()} onReplaceChange={vi.fn()} onCaseSensitiveToggle={vi.fn()} onPrev={vi.fn()}
    onNext={onNext} onReplace={onReplace} onReplaceAll={vi.fn()} onClose={onClose}
    findInputRef={{ current: null }} />);
  const inputs = screen.getAllByRole('textbox');

  fireEvent.keyDown(inputs[0], { key: 'Enter', isComposing: true });
  fireEvent.keyDown(inputs[0], { key: 'Enter', keyCode: 229 });
  fireEvent.keyDown(inputs[1], { key: 'Enter', isComposing: true });
  fireEvent.keyDown(window, { key: 'Escape', isComposing: true });
  fireEvent.keyDown(window, { key: 'Escape', keyCode: 229 });

  expect(onNext).not.toHaveBeenCalled();
  expect(onReplace).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();

  fireEvent.keyDown(inputs[0], { key: 'Enter' });
  fireEvent.keyDown(inputs[1], { key: 'Enter' });
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onNext).toHaveBeenCalledOnce();
  expect(onReplace).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});

it('closes the foreground tools popup on Escape without closing background Find/Replace', () => {
  const onClose = vi.fn();
  render(<>
    <EditorToolsMenu
      t={useI18nStore.getState().t}
      showFR
      showTS={false}
      showScale={false}
      onToggleFR={vi.fn()}
      onToggleTS={vi.fn()}
      onToggleScale={vi.fn()}
      onOpenBpmSnap={vi.fn()}
    />
    <FindReplaceBar findText="text" replaceText="new" caseSensitive={false} matchCount={1} matchPos={0}
      onFindChange={vi.fn()} onReplaceChange={vi.fn()} onCaseSensitiveToggle={vi.fn()} onPrev={vi.fn()}
      onNext={vi.fn()} onReplace={vi.fn()} onReplaceAll={vi.fn()} onClose={onClose}
      findInputRef={{ current: null }} />
  </>);

  const toolsTrigger = screen.getByRole('button', { name: useI18nStore.getState().t.editorTools });
  fireEvent.click(toolsTrigger);
  fireEvent.keyDown(toolsTrigger, { key: 'Escape', isComposing: false, keyCode: 229 });
  expect(screen.getByRole('button', { name: useI18nStore.getState().t.findReplace })).toBeTruthy();
  fireEvent.keyDown(toolsTrigger, { key: 'Escape' });

  expect(screen.queryByRole('button', { name: useI18nStore.getState().t.findReplace })).toBeNull();
  expect(screen.getAllByRole('textbox')).toHaveLength(2);
  expect(document.activeElement).toBe(toolsTrigger);
  expect(onClose).not.toHaveBeenCalled();
});
