const { toDateOnlyString, toLocalDateOnlyString } = require('../utils/dateOnly');

function modelIdFor(conversation) {
  return conversation.metadata?.model || '';
}

function describeModel(card, today) {
  const date = toDateOnlyString(card.deprecation_date);
  const status = !date ? 'none' : date < today ? 'deprecated' : 'scheduled';
  const warning = !date ? '' : date < today
    ? `AI model deprecated since ${date}. Switch to a supported model.`
    : date === today
      ? `AI model deprecates today (${date}). Switch to a supported model.`
      : `AI model scheduled for deprecation on ${date}. Plan to switch models.`;
  return {
    name: card.model_name,
    provider: card.provider,
    type: card.model_type,
    input: card.in_modalities || [],
    output: card.out_modalities || [],
    maxTokens: card.max_tokens,
    maxOutputTokens: card.max_out_tokens,
    status,
    warning,
  };
}

function buildConversationList(conversations, cards, pendingIds, now = new Date()) {
  const today = toLocalDateOnlyString(now);
  const pending = new Set(pendingIds.map(String));
  const cardsById = new Map();
  for (const card of cards) {
    if (!cardsById.has(card.api_model)) cardsById.set(card.api_model, []);
    cardsById.get(card.api_model).push(describeModel(card, today));
  }
  return conversations.map(conversation => {
    const c = typeof conversation.toObject === 'function' ? conversation.toObject() : conversation;
    const modelId = modelIdFor(c);
    const modelCards = cardsById.get(modelId) || [];
    const isPending = pending.has(String(c._id));
    return {
      ...c,
      modelId,
      modelCards,
      isPending,
      filters: {
        category: [c.category || ''],
        model: [modelId],
        tag: c.tags || [],
        member: c.members || [],
        pending: [isPending ? 'pending' : 'idle'],
        source: [c.old ? 'legacy' : 'current'],
        reasoning: [c.metadata?.reasoning || ''],
        mode: [c.metadata?.mode || ''],
        provider: modelCards.map(card => card.provider),
        type: modelCards.map(card => card.type),
        input: modelCards.flatMap(card => card.input),
        output: modelCards.flatMap(card => card.output),
        deprecation: modelCards.length ? [...new Set(modelCards.map(card => card.status))] : ['unknown'],
      },
    };
  });
}

function buildConversationFilters(conversations, sortedCategories) {
  const labels = {
    category: 'Category', model: 'Model ID', deprecation: 'Model deprecation',
    tag: 'Tag', member: 'Member', pending: 'Request status', source: 'Conversation version',
    provider: 'Provider', type: 'Model type', input: 'Input modality', output: 'Output modality',
    reasoning: 'Reasoning level', mode: 'Conversation mode',
  };
  const fixed = {
    category: sortedCategories.map(value => ({ value, label: value })),
    deprecation: [
      { value: 'scheduled', label: 'Scheduled (including today)' },
      { value: 'deprecated', label: 'Already deprecated' },
      { value: 'none', label: 'No deprecation date' },
      { value: 'unknown', label: 'Model card unavailable' },
    ],
    pending: [{ value: 'pending', label: 'Pending' }, { value: 'idle', label: 'No pending request' }],
    source: [{ value: 'current', label: 'Current' }, { value: 'legacy', label: 'Legacy' }],
  };
  return Object.entries(labels).map(([key, label]) => ({
    key,
    label,
    options: fixed[key] || [...new Set(conversations.flatMap(c => c.filters[key]).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
      .map(value => ({ value, label: value })),
  }));
}

module.exports = { modelIdFor, buildConversationList, buildConversationFilters };
