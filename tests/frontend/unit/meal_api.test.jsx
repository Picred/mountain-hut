import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMealsByDate } from '../../../frontend/src/api/meal_api.js';

function mockResponse({ ok = true, status = 200, body = {}, invalidJson = false } = {}) {
  return {
    ok,
    status,
    json: invalidJson
      ? vi.fn().mockRejectedValue(new SyntaxError('Invalid JSON'))
      : vi.fn().mockResolvedValue(body),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('meal_api.getMealsByDate', () => {
  it('requests the public meal endpoint with an encoded date', async () => {
    const meals = [{ slotId: 12, date: '2028-06-01', menu: '**Lunch**' }];
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ body: meals }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getMealsByDate('2028-06-01')).resolves.toEqual(meals);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/slots/meals?date=2028-06-01'
    );
  });

  it('maps 400 responses to a valid-date error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({
      ok: false,
      status: 400,
      body: { error: 'INVALID_DATE' },
    })));

    await expect(getMealsByDate('invalid')).rejects.toThrow(
      'The selected date is not valid.'
    );
  });

  it('maps server responses to a generic loading error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({
      ok: false,
      status: 500,
      body: { error: 'INTERNAL_SERVER_ERROR' },
    })));

    await expect(getMealsByDate('2028-06-01')).rejects.toThrow(
      'Could not load the meal details. Please try again.'
    );
  });

  it('handles a fetch network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network error')));

    await expect(getMealsByDate('2028-06-01')).rejects.toThrow(
      'Could not load the meal details. Please try again.'
    );
  });

  it('handles a response with invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({
      ok: false,
      status: 500,
      invalidJson: true,
    })));

    await expect(getMealsByDate('2028-06-01')).rejects.toThrow(
      'Could not load the meal details. Please try again.'
    );
  });
});
