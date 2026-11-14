import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const capacityAPI = vi.hoisted(() => ({
  getPreviousMenus: vi.fn(),
  saveSlotMenu: vi.fn(),
  deleteSlotMenu: vi.fn(),
}));

vi.mock('../../../frontend/src/api/capacity_api', () => ({
  default: capacityAPI,
}));

import SlotMenuEditor from '../../../frontend/src/components/SlotMenuEditor';

function futureSlot(menu = null) {
  return {
    slotId: 12,
    startAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    menu,
  };
}

function renderEditor({ menu = null } = {}) {
  const onMenuSaved = vi.fn();
  const onMenuDeleted = vi.fn();

  render(
    <SlotMenuEditor
      slot={futureSlot(menu)}
      onMenuSaved={onMenuSaved}
      onMenuDeleted={onMenuDeleted}
    />
  );

  return { onMenuSaved, onMenuDeleted };
}

beforeEach(() => {
  vi.clearAllMocks();
  capacityAPI.getPreviousMenus.mockResolvedValue([]);
  capacityAPI.saveSlotMenu.mockResolvedValue({ slotId: 12, menu: '**Lunch**' });
  capacityAPI.deleteSlotMenu.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('SlotMenuEditor', () => {
  it('reuses a previous menu, allows edits, and saves the changed content', async () => {
    const user = userEvent.setup();
    const reusableMenu = '**Lunch menu**\n- Pasta';
    const updatedMenu = `${reusableMenu}\n- Salad`;
    capacityAPI.getPreviousMenus.mockResolvedValue([{ menu: reusableMenu }]);
    capacityAPI.saveSlotMenu.mockResolvedValue({ slotId: 12, menu: updatedMenu });
    const { onMenuSaved } = renderEditor();

    const menuSelect = await screen.findByRole('combobox', {
      name: 'Reuse a Previous Menu',
    });
    await user.selectOptions(menuSelect, '0');

    const editor = screen.getByRole('textbox');
    expect(editor).toHaveValue(reusableMenu);

    await user.type(editor, '\n- Salad');
    await user.click(screen.getByRole('button', { name: 'Save Menu' }));

    await waitFor(() => {
      expect(capacityAPI.saveSlotMenu).toHaveBeenCalledWith(12, updatedMenu);
    });
    expect(onMenuSaved).toHaveBeenCalledWith(updatedMenu);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Menu saved successfully!'
    );
  });

  it('inserts Markdown formatting from the toolbar', async () => {
    const user = userEvent.setup();
    renderEditor();

    const editor = screen.getByRole('textbox');
    await user.type(editor, 'Pasta');
    editor.setSelectionRange(0, 5);
    await user.click(screen.getByRole('button', { name: 'Bold' }));

    await waitFor(() => expect(editor).toHaveValue('**Pasta**'));

    editor.setSelectionRange(2, 7);
    await user.click(screen.getByRole('button', { name: 'Italic' }));

    await waitFor(() => expect(editor).toHaveValue('***Pasta***'));
  });

  it('inserts bulleted and nested list items from the toolbar', async () => {
    const user = userEvent.setup();
    renderEditor();

    const editor = screen.getByRole('textbox');
    await user.type(editor, 'Soup\nBread');
    editor.setSelectionRange(0, 10);
    await user.click(screen.getByRole('button', { name: 'Bulleted List' }));

    await waitFor(() => expect(editor).toHaveValue('- Soup\n- Bread'));

    editor.setSelectionRange(7, 14);
    await user.click(screen.getByRole('button', { name: 'Nested List' }));

    await waitFor(() => expect(editor).toHaveValue('- Soup\n  - Bread'));
  });

  it('renders Markdown text and nested lists in the preview', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.type(
      screen.getByRole('textbox'),
      '**Soup**\n*Salad*\n- Bread\n  - Butter'
    );
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(screen.getByText('Soup').tagName).toBe('STRONG');
    expect(screen.getByText('Salad').tagName).toBe('EM');
    expect(screen.getAllByRole('list')).toHaveLength(2);
    expect(screen.getByText('Butter')).toBeInTheDocument();
  });

  it('confirms menu deletion and notifies the parent', async () => {
    const user = userEvent.setup();
    const { onMenuDeleted } = renderEditor({ menu: '**Old menu**' });

    await user.click(screen.getByRole('button', { name: 'Delete Menu' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Delete' }));

    await waitFor(() => {
      expect(capacityAPI.deleteSlotMenu).toHaveBeenCalledWith(12);
    });
    expect(onMenuDeleted).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Menu deleted successfully!'
    );
  });
});
