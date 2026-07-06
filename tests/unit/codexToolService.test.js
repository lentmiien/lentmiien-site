jest.mock('../../models/codex_event', () => ({
  find: jest.fn(),
}));

const CodexEvent = require('../../models/codex_event');
const codexToolService = require('../../services/codexToolService');

function createEventQuery(events) {
  const query = {
    sort: jest.fn(() => query),
    limit: jest.fn(() => query),
    lean: jest.fn(() => query),
    exec: jest.fn().mockResolvedValue(events),
  };
  return query;
}

describe('codexToolService.listTurnEvents', () => {
  beforeEach(() => {
    CodexEvent.find.mockReset();
  });

  test('returns all events when no limit is requested', async () => {
    const query = createEventQuery([
      { _id: 'event-1', turnId: 'turn-1', seq: 1, eventType: 'turn.started' },
      { _id: 'event-2', turnId: 'turn-1', seq: 2, eventType: 'turn.completed' },
    ]);
    CodexEvent.find.mockReturnValue(query);

    const events = await codexToolService.listTurnEvents('turn-1');

    expect(CodexEvent.find).toHaveBeenCalledWith({
      turnId: 'turn-1',
      seq: { $gt: 0 },
    });
    expect(query.sort).toHaveBeenCalledWith({ seq: 1 });
    expect(query.limit).not.toHaveBeenCalled();
    expect(events).toHaveLength(2);
  });

  test('honors explicit limits for callers that request one', async () => {
    const query = createEventQuery([]);
    CodexEvent.find.mockReturnValue(query);

    await codexToolService.listTurnEvents('turn-1', { afterSeq: 5, limit: 25 });

    expect(CodexEvent.find).toHaveBeenCalledWith({
      turnId: 'turn-1',
      seq: { $gt: 5 },
    });
    expect(query.limit).toHaveBeenCalledWith(25);
  });
});

describe('codexToolService token usage helpers', () => {
  test('normalizes OpenAI-style token details into separated buckets', () => {
    const usage = codexToolService.normalizeTokenUsage({
      input_tokens: 1200,
      input_tokens_details: { cached_tokens: 800 },
      output_tokens: 300,
      output_tokens_details: { reasoning_tokens: 75 },
      total_tokens: 1500,
    });

    expect(usage).toEqual({
      input: 1200,
      cached: 800,
      output: 300,
      reasoning: 75,
      total: 1500,
    });
  });

  test('estimates costs without double-counting cached or reasoning tokens', () => {
    const cost = codexToolService.estimateTokenCost(
      {
        input: 1200,
        cached: 800,
        output: 300,
        reasoning: 75,
      },
      {
        currency: 'USD',
        unitTokens: 1000000,
        prices: {
          input: 2,
          cached: 0.5,
          output: 8,
          reasoning: 8,
        },
      }
    );

    expect(cost.billableTokens).toEqual({
      input: 400,
      cached: 800,
      output: 225,
      reasoning: 75,
    });
    expect(cost.total).toBeCloseTo(0.0036, 8);
  });
});
