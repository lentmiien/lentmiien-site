// One bounded activity history, two replaceable telemetry slots, and one cap notice.
// Sequence numbers always advance, including replacements, so incremental readers
// can keep following a turn after its retained record count stops growing.
const TELEMETRY_TYPES = new Set(['thread.tokenusage.updated', 'account.ratelimits.updated']);

function eventPolicy(event) {
  const type = String(event.eventType || '').replace(/\//g, '.').toLowerCase();
  const payload = event.payload?.payload || event.payload || {};
  const item = payload.item || {};
  const itemType = String(item.type || '').replace(/_/g, '').toLowerCase();
  const exitCode = item.exitCode ?? item.exit_code;
  const important = ['agentmessage', 'assistantmessage', 'usermessage'].includes(itemType) ||
    ['warning', 'error'].includes(event.severity) || event.stream === 'stderr' ||
    /(?:error|warning|failed|failure|cancelled|canceled|timed_out)/.test(type) ||
    /^(?:failed|error|declined|rejected|interrupted|blocked)$/.test(String(item.status || payload.status || '').toLowerCase()) ||
    Boolean(item.error || item.failure || payload.error) ||
    (typeof exitCode === 'number' && exitCode !== 0) ||
    /^turn\.(?:completed|succeeded|blocked)$/.test(type);
  return { important, telemetry: !important && TELEMETRY_TYPES.has(type) ? type : null };
}

class CodexTurnEventStore {
  constructor({ limit, write }) {
    this.limit = limit;
    this.write = write;
    this.nextSeq = 1;
    this.routine = [];
    this.important = [];
    this.telemetry = new Map();
    this.cappedAt = null;
    this.omittedCount = 0;
    this.coalescedCount = 0;
    this.lastExecutionActivityAt = null;
  }

  get count() {
    return this.routine.length + this.important.length + this.telemetry.size + (this.cappedAt ? 1 : 0);
  }

  snapshot() {
    return {
      eventStorage: {
        limit: this.limit,
        cappedAt: this.cappedAt,
        omittedCount: this.omittedCount,
        coalescedCount: this.coalescedCount,
      },
      eventCount: this.count,
      lastExecutionActivityAt: this.lastExecutionActivityAt,
    };
  }

  async store(event) {
    const { important, telemetry } = eventPolicy(event);
    if (!telemetry && event.stream !== 'system') this.lastExecutionActivityAt = new Date();
    if (telemetry) {
      const previousSeq = this.telemetry.get(telemetry);
      await this.write(this.nextSeq, event, previousSeq);
      this.telemetry.set(telemetry, this.nextSeq++);
      if (previousSeq) this.coalescedCount += 1;
      return { stored: true, count: this.count };
    }

    let replacedQueue = null;
    if (this.routine.length + this.important.length >= this.limit) {
      if (!this.cappedAt) {
        await this.write(this.nextSeq, {
          stream: 'system', eventType: 'events.truncated', severity: 'warning',
          text: `Activity storage capped at ${this.limit} records. Messages, errors, and completion updates continue; older details may be replaced.`,
        });
        this.nextSeq += 1;
        this.cappedAt = new Date();
      }
      if (!important) {
        this.omittedCount += 1;
        return { stored: false, count: this.count };
      }
      replacedQueue = this.routine.length ? this.routine : this.important;
    }
    await this.write(this.nextSeq, event, replacedQueue?.[0]);
    if (replacedQueue) {
      replacedQueue.shift();
      this.omittedCount += 1;
    }
    (important ? this.important : this.routine).push(this.nextSeq++);
    return { stored: true, count: this.count };
  }
}

module.exports = { CodexTurnEventStore, eventPolicy };
