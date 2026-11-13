import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// the component uses a mocked copyWeeklySchedule, the API tests use the real one
vi.mock('../../../frontend/src/api/capacity_api', async (importOriginal) => {
  const actual = await importOriginal();
  return { default: { ...actual.default, copyWeeklySchedule: vi.fn() } };
});

import capacityAPI from '../../../frontend/src/api/capacity_api';
import CopyWeeklySchedule from '../../../frontend/src/components/CopyWeeklySchedule';

const { default: realAPI } = await vi.importActual('../../../frontend/src/api/capacity_api');

// a timezone other than the hut's, to check that times are shown in the hut's timezone
const originalTZ = process.env.TZ;
process.env.TZ = 'UTC';

afterAll(() => {
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
});

const SERVER_URL = 'http://localhost:3001';

function mockResponse({ ok = true, body = {}, invalidJson = false } = {}) {
  return {
    ok,
    json: invalidJson
      ? vi.fn().mockRejectedValue(new SyntaxError('Invalid JSON'))
      : vi.fn().mockResolvedValue(body),
  };
}

let fetchMock;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('copyWeeklySchedule API', () => {
  it('sends a POST copying tables and menu and returns the result', async () => {
    const result = { created: [{ slotId: 100 }], skipped: [] };
    fetchMock.mockResolvedValue(mockResponse({ body: result }));

    await expect(realAPI.copyWeeklySchedule('2027-01-04', '2027-01-11')).resolves.toEqual(result);

    expect(fetchMock).toHaveBeenCalledWith(`${SERVER_URL}/api/slots/copy-week`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ fromDate: '2027-01-04', toDate: '2027-01-11', copyTables: true, copyMenu: true }),
    });
  });

  it.each([
    ['the server message', { body: { message: 'NO_SLOTS_TO_COPY', error: 'Bad Request' } }, 'NO_SLOTS_TO_COPY'],
    ['the server error', { body: { error: 'Forbidden' } }, 'Forbidden'],
    ['a default message for an invalid body', { invalidJson: true }, 'Unable to copy weekly schedule'],
  ])('throws %s when the request fails', async (_, response, message) => {
    fetchMock.mockResolvedValue(mockResponse({ ok: false, ...response }));

    await expect(realAPI.copyWeeklySchedule('2027-01-04', '2027-01-11')).rejects.toThrow(message);
  });
});

describe('CopyWeeklySchedule', () => {
  function renderModal() {
    const props = { onClose: vi.fn(), onSuccess: vi.fn().mockResolvedValue() };
    render(<CopyWeeklySchedule {...props} />);
    return props;
  }

  const pick = (label, date) => fireEvent.change(screen.getByLabelText(label), { target: { value: date } });

  const pickWeeks = (source, destination) => {
    pick('Source Week', source);
    pick('Destination Week', destination);
  };

  const copyButton = () => screen.getByRole('button', { name: 'Copy Schedule' });

  it('shows the Monday to Sunday weeks of the chosen days and warns that the destination is replaced', () => {
    renderModal();

    // a Sunday belongs to the week of the previous Monday
    pick('Source Week', '2027-01-03');
    expect(copyButton()).toBeDisabled();
    pick('Destination Week', '2027-01-13');

    expect(screen.getAllByText('Week 2026-12-28 - 2027-01-03')).toHaveLength(2);
    expect(screen.getAllByText('Week 2027-01-11 - 2027-01-17')).toHaveLength(2);
    expect(screen.getByText(/it will be completely replaced/)).toBeInTheDocument();
    expect(copyButton()).toBeEnabled();
  });

  it('does not allow two days of the same week', () => {
    renderModal();

    pickWeeks('2027-01-04', '2027-01-10');

    expect(screen.getByRole('alert')).toHaveTextContent('Source and destination weeks must be different.');
    expect(copyButton()).toBeDisabled();
  });

  it('copies the chosen weeks, then refreshes the slots and closes', async () => {
    let finishCopy;
    capacityAPI.copyWeeklySchedule.mockReturnValue(new Promise((resolve) => { finishCopy = resolve; }));
    const { onClose, onSuccess } = renderModal();
    pickWeeks('2027-01-06', '2027-01-14');

    await userEvent.click(copyButton());

    expect(capacityAPI.copyWeeklySchedule).toHaveBeenCalledWith('2027-01-04', '2027-01-11');
    // no second copy and no changes while copying
    expect(screen.getByRole('button', { name: 'Copying...' })).toBeDisabled();
    expect(screen.getByLabelText('Source Week')).toBeDisabled();
    expect(screen.getByLabelText('Destination Week')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(onSuccess).not.toHaveBeenCalled();

    finishCopy({ created: [{ slotId: 100 }], skipped: [] });

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
  });

  it('refreshes the slots, tells the user and stays open when every slot is skipped', async () => {
    capacityAPI.copyWeeklySchedule.mockResolvedValue({
      created: [],
      skipped: [{ startAt: '2020-01-06T11:00:00.000Z', endAt: '2020-01-06T13:00:00.000Z', reason: 'SLOT_IN_THE_PAST' }],
    });
    const { onClose, onSuccess } = renderModal();
    // the destination week is in the past
    pickWeeks('2027-01-04', '2020-01-06');

    await userEvent.click(copyButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('No slots were copied. All slots were skipped.');
    // the destination week was replaced anyway
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(copyButton()).toBeEnabled();
  });

  it('lists the reserved destination slots and stays open when the copy is refused', async () => {
    capacityAPI.copyWeeklySchedule.mockRejectedValue(new Error(
      'SLOT_HAS_RESERVATIONS: slotId: 8 (2027-01-12T11:00:00.000Z - 2027-01-12T13:00:00.000Z), '
      + 'slotId: 9 (2027-01-15T17:00:00.000Z - 2027-01-15T19:30:00.000Z)'
    ));
    const { onClose, onSuccess } = renderModal();
    pickWeeks('2027-01-04', '2027-01-11');

    await userEvent.click(copyButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The destination week contains existing reservations.');
    // times in the hut's timezone (the comma after the weekday depends on the ICU version)
    expect(alert).toHaveTextContent(/Tuesday,? 12 January 2027/);
    expect(alert).toHaveTextContent('12:00 – 14:00');
    expect(alert).toHaveTextContent(/Friday,? 15 January 2027/);
    expect(alert).toHaveTextContent('18:00 – 20:30');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(copyButton()).toBeEnabled();
  });

  it('shows any other error as it is', async () => {
    capacityAPI.copyWeeklySchedule.mockRejectedValue(new Error('NO_SLOTS_TO_COPY'));
    const { onClose } = renderModal();
    pickWeeks('2027-01-04', '2027-01-11');

    await userEvent.click(copyButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/^NO_SLOTS_TO_COPY$/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(['Cancel', 'Close modal'])('closes without copying with the %s button', async (name) => {
    const { onClose } = renderModal();

    await userEvent.click(screen.getByRole('button', { name }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(capacityAPI.copyWeeklySchedule).not.toHaveBeenCalled();
  });
});
