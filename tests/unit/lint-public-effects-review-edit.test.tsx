// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditFieldModal } from '../../src/components/charter/ReviewEditModals';

const baseProps = {
  onSave: vi.fn(),
  onClose: vi.fn(),
  saveLabel: 'Save',
  cancelLabel: 'Cancel',
};

describe('EditFieldModal public state reset', () => {
  it('resets the draft for a changed field value and keeps save and cancel callbacks', () => {
    const { rerender } = render(
      <EditFieldModal {...baseProps} spec={{ key: 'note', label: 'Note', type: 'text', value: 'first' }} />,
    );
    const input = screen.getByDisplayValue('first');
    fireEvent.change(input, { target: { value: 'draft' } });
    expect(screen.getByDisplayValue('draft')).toBeTruthy();

    rerender(<EditFieldModal {...baseProps} spec={{ key: 'note', label: 'Note', type: 'text', value: 'server update' }} />);
    expect(screen.getByDisplayValue('server update')).toBeTruthy();

    fireEvent.click(screen.getByText('Save'));
    expect(baseProps.onSave).toHaveBeenLastCalledWith('server update');
    fireEvent.click(screen.getByText('Cancel'));
    expect(baseProps.onClose).toHaveBeenCalled();
  });
});
