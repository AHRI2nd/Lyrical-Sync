// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FindReplaceBar } from './FindReplaceBar';

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
