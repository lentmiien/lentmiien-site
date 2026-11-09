// Only application-owned validation messages may be shown to chat clients.
class ChatInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ChatInputError';
    this.code = code;
  }
}

module.exports = { ChatInputError };
