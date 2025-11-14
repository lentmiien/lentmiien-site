# Project Idea 013 – Voice Assistant Interface

## Goal
Introduce a voice-driven assistant that can converse with the platform, execute common workflows, and leverage existing tools (Chat5, scheduling, budgeting). The assistant should support speech-to-text input, natural language understanding via the chat stack, and text-to-speech responses.

## Scope Overview
- Integrate a browser-based speech capture component (Web Speech API or Azure/Google STT) with fallbacks.
- Route transcribed text through Chat5 (or dedicated intent parser) to identify commands and use toolkits (API endpoints) to act.
- Generate spoken responses using TTS (OpenAI, AWS Polly, or browser voices) and present confirmation UIs.
- Provide a permissions framework restricting what the assistant can do per user/session.

## Key Code Touchpoints
- Front-end components under `public/js/voiceAssistant.js`, new Pug templates or modals for voice interface.
- Backend orchestration in `controllers/voiceassistantcontroller.js`, `routes/voiceassistant.js`.
- Reuse `services/conversationService.js`, `services/templateService.js`, and new `services/voiceCommandService.js` for intent mapping.
- Socket namespace for real-time updates (`socket_io/voiceassistant.js`).
- Update API docs (Project Idea 008) with assistant command endpoints.

## Implementation Notes
1. **Speech pipeline** – Implement client-side STT with streaming to the server. Support push-to-talk and continuous listening modes with visual indicators.
2. **Intent handling** – Define a command schema that maps natural language to actions (e.g., “Add milk to grocery list” → call cooking workflow). Use Chat5 to parse intents or maintain a separate NLU model with fallback to Chat5 prompts.
3. **Action execution** – Once an intent is identified, call the relevant service/API, handle errors gracefully, and provide textual plus spoken feedback.
4. **TTS output** – Generate audio clips (via TTS API) streamed back to the browser, with caching for repeated phrases.
5. **Security & logging** – Log all assistant actions, require explicit user confirmation for sensitive tasks, and allow revocation of voice permissions.

## Dependencies / Follow-ups
- Builds on Project Idea 008 (API docs) for assistant tool discovery and Project Idea 012 (Master Feed) to log assistant actions in the feed.
- Future enhancement: integrate with hardware devices (smart speakers) once the core interface stabilises.
