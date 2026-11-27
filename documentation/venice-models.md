# Venice through the AI Gateway

The Codex dashboard offers Venice when the site's Gateway advertises Venice models at `GET /llm/models`. The picker refreshes its catalog on page load, with a 30-second server cache. Venice sessions use the selected full model ID and the `gateway` Codex profile with low reasoning effort. They use no worker GPU reservation. Configure Venice rates in the dashboard's token pricing section for separate cost estimates.

Install `gateway.config.toml` in the Codex home of each execution account, register the profile's `ai_gateway` provider in its base Codex config, and configure its Gateway URL and client credential path. On SSH and container targets these paths and the URL must work from that target. Install the local Gateway skills there to enable local inference or image generation during remote reasoning.

Chat5 uses the same catalog when the site server has `VENICE_GATEWAY_CLIENT_TOKEN_FILE` (path to a one-line Gateway client credential) or `VENICE_GATEWAY_CLIENT_TOKEN`. The upstream Venice key belongs on the Gateway. Chat5 sends selected text and images to the configured Gateway using `OLLAMA_BASE_URL` or `AI_GATEWAY_BASE_URL`, and saves the foreground reply. Deselect Chat5 tools when using this mode.
