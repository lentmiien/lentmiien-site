# Learning Lab

## What This Tool Is

Learning Lab is an authenticated lesson system plus an admin CMS.

At runtime, the content hierarchy is:

`Topic -> Subtopic -> Item`

- A **topic** is a top-level subject area shown on `/learning`.
- A **subtopic** is a playable lesson inside a topic.
- An **item** is one step inside a lesson. Items are either:
  - an **activity** (`scene`)
  - a **question** (`single_choice`, `count_target`, `builder_sequence`, `state_change`)

The system also has:

- **Template profiles**: reusable presets for item forms
- **Art assets**: reusable uploaded SVG resources
- **Progress and attempts**: per-user lesson state and answer history

Everything is backed by MongoDB collections, even though people may casually call them "tables".

## Core Files

### Routing and controllers

- `app.js`
  - Mounts `/learning` behind `isAuthenticated`
  - Mounts `/admin` behind `isAuthenticated` + `isAdmin`
- `routes/learning.js`
  - Public learner routes and player APIs
- `routes/admin.js`
  - Learning CMS routes, art upload route, learner analytics routes
- `controllers/learningcontroller.js`
  - Learner-facing page rendering
  - Item submission API
  - Subtopic reset API
  - Admin-only preview mode detection
- `controllers/learningAdminController.js`
  - CMS page rendering
  - Save/delete handlers for topics, subtopics, items, and template profiles
  - SVG art upload
  - Learner overview and learner profile pages

### Service layer

- `services/learningService.js`
  - This is the center of the tool
  - Handles validation, slug generation, stable IDs, theme resolution, art normalization, public payload shaping, progress logic, attempt logging, admin dashboard data, art library data, user analytics, and seed content

### Mongo models

- `models/learning_topic.js`
- `models/learning_subtopic.js`
- `models/learning_item.js`
- `models/learning_template_profile.js`
- `models/learning_art_asset.js`
- `models/learning_progress.js`
- `models/learning_attempt.js`
- `models/learning_shared.js`
  - Shared embedded schemas for theme, reward, and art

### Views and front-end scripts

- `views/learning_home.pug`
- `views/learning_topic.pug`
- `views/learning_subtopic.pug`
- `public/js/learning-player.js`
  - The actual lesson player
- `views/admin_learning.pug`
- `views/admin_learning_art.pug`
- `views/admin_learning_users.pug`
- `views/admin_learning_user_profile.pug`
- `public/js/admin_learning.js`
  - CMS-only client behavior:
    - art picker modal
    - template profile apply
    - copy item into template editor
    - delete confirmations

### Styling

- `public/css/learning.css`
- `public/css/admin-learning.css`

## Page and Route Map

### Learner pages

| Route | Access | Purpose |
| --- | --- | --- |
| `/learning` | Authenticated users | Topic home page |
| `/learning/topic/:topicSlug` | Authenticated users | Topic page listing subtopics |
| `/learning/topic/:topicSlug/:subtopicSlug` | Authenticated users | Playable lesson page |

### Learner APIs used by the player

| Route | Access | Purpose |
| --- | --- | --- |
| `POST /learning/api/subtopics/:subtopicStableId/items/:itemStableId/submit` | Authenticated users | Submit one item answer or complete a scene |
| `POST /learning/api/subtopics/:subtopicStableId/reset` | Authenticated users | Reset one subtopic's progress for the current user |

### Admin pages

| Route | Access | Purpose |
| --- | --- | --- |
| `/admin/learning` | Admin only | Main Learning CMS |
| `/admin/learning/art` | Admin only | SVG art library |
| `/admin/learning/users` | Admin only | Learner progress overview |
| `/admin/learning/users/:userId` | Admin only | Single learner profile |

### Preview mode

Preview mode is enabled only for admin users, and only when `?preview=1` is present on a learner route.

Example:

- `/learning/topic/weather?preview=1`
- `/learning/topic/weather/clouds?preview=1`

Preview mode does two important things:

- shows **draft** content
- does **not** save progress or attempts

That makes it safe for editors to test unfinished lessons.

## Content Structure

### Topic

A topic is the top-level subject. It controls:

- title, slug, description
- sort order
- published vs draft status
- shared visual theme defaults
- optional topic-level reward data

The learner home page shows topics as cards.

### Subtopic

A subtopic is a single lesson inside a topic. It controls:

- topic relationship
- slug within that topic
- title, description
- estimated minutes
- published vs draft status
- optional theme overrides
- the lesson reward sticker

The topic page shows subtopics as lesson cards, progress bars, and sticker shelf entries.

### Item

An item is a single playable step inside a subtopic. It controls:

- title
- order in the lesson
- template type
- prompt/helper/blurb text
- stars
- template-specific config

The lesson player loads items in `order`, then `title`.

## How Lessons Behave At Runtime

The player behavior matters when designing content:

- Items are played sequentially.
- The current item is always the **first incomplete item**.
- `scene` items are activities and always award `0` stars.
- Question items award stars only the **first time** they are completed correctly.
- Learners must solve a question correctly before the `Next` button unlocks.
- Wrong answers do not end the lesson. The learner can try again.
- A subtopic sticker unlocks only when **all items in the subtopic** are completed.
- Resetting a lesson deletes that user's `learning_progress` document for the subtopic and recreates a fresh one.

## Database Collections / Tables

## `learning_topic`

High-level subject container.

Important fields:

| Field | Type | Notes |
| --- | --- | --- |
| `stableId` | string | Unique, immutable, generated by service |
| `slug` | string | Unique globally |
| `title` | string | Required |
| `shortLabel` | string | Stored, currently not surfaced in learner UI |
| `description` | string | Topic summary |
| `status` | `draft` or `published` | Controls learner visibility |
| `order` | number | Sorting |
| `theme` | embedded object | Colors, background, art |
| `reward` | embedded object | Stored, but learner reward system is subtopic-based |
| `metadata` | mixed | Reserved/future use |
| `createdBy`, `updatedBy` | string | Audit trail |
| `createdAt`, `updatedAt` | date | Mongoose timestamps |

## `learning_subtopic`

Lesson inside a topic.

Important fields:

| Field | Type | Notes |
| --- | --- | --- |
| `topicId` | ObjectId | Parent topic |
| `topicStableId` | string | Denormalized copy |
| `topicSlug` | string | Denormalized copy |
| `stableId` | string | Unique, immutable |
| `slug` | string | Unique within `topicId` |
| `title` | string | Required |
| `description` | string | Lesson card copy |
| `status` | `draft` or `published` | Controls learner visibility |
| `order` | number | Sorting |
| `estimatedMinutes` | number | Displayed on topic page |
| `theme` | embedded object | Overrides topic theme |
| `reward` | embedded object | Sticker label, description, art |
| `metadata` | mixed | Reserved/future use |
| `createdBy`, `updatedBy` | string | Audit trail |
| `createdAt`, `updatedAt` | date | Mongoose timestamps |

## `learning_item`

Playable step inside a lesson.

Important fields:

| Field | Type | Notes |
| --- | --- | --- |
| `topicId`, `topicStableId`, `topicSlug` | refs + strings | Denormalized parent info |
| `subtopicId`, `subtopicStableId`, `subtopicSlug` | refs + strings | Denormalized parent info |
| `stableId` | string | Unique, immutable, used by submit API |
| `title` | string | Required |
| `prompt` | string | Main question prompt for question templates |
| `helperText` | string | Supporting instruction |
| `blurb` | string | Header blurb in the player |
| `kind` | `activity` or `question` | Automatically derived from template type |
| `templateType` | string | One of the supported templates |
| `status` | `draft` or `published` | Controls learner visibility |
| `order` | number | Lesson sequence |
| `points` | number | `0-10`, but forced to `0` for scenes |
| `config` | mixed | Template-specific payload |
| `createdBy`, `updatedBy` | string | Audit trail |
| `createdAt`, `updatedAt` | date | Mongoose timestamps |

## `learning_template_profile`

Reusable preset for item authoring.

Important fields:

| Field | Type | Notes |
| --- | --- | --- |
| `stableId` | string | Unique, immutable |
| `slug` | string | Unique globally |
| `title` | string | Required |
| `description` | string | CMS-only descriptive text |
| `templateType` | string | Template kind |
| `order` | number | Sorting in CMS |
| `defaultItemTitle` | string | Optional title to apply into item form |
| `prompt`, `helperText`, `blurb`, `points` | mixed | Default item values |
| `config` | mixed | Template-specific defaults |

Important: template profiles are **copy-only**. Items do **not** store a link to a template profile. Updating a template profile does **not** update existing items.

## `learning_art_asset`

Reusable uploaded SVG art library.

Important fields:

| Field | Type | Notes |
| --- | --- | --- |
| `stableId` | string | Unique, immutable |
| `key` | string | Unique built-in art value used in CMS |
| `title` | string | Human label |
| `description` | string | Usage note |
| `svgMarkup` | string | Sanitized SVG stored in MongoDB |
| `source` | string | Currently always `upload` |
| `createdBy`, `updatedBy` | string | Audit trail |
| `createdAt`, `updatedAt` | date | Mongoose timestamps |

## `learning_progress`

One document per user per subtopic.

Important fields:

| Field | Type | Notes |
| --- | --- | --- |
| `userId`, `userName` | ref + string | Learner |
| `topicId`, `topicStableId`, `topicSlug` | refs + strings | Topic snapshot |
| `subtopicId`, `subtopicStableId`, `subtopicSlug` | refs + strings | Lesson snapshot |
| `status` | `not_started`, `in_progress`, `completed` | Overall lesson state |
| `currentItemIndex` | number | First incomplete item |
| `currentItemStableId` | string | First incomplete item stable ID |
| `totalStars`, `maxStars` | number | Lesson totals |
| `stickerUnlocked` | boolean | True after full lesson completion |
| `stickerLabel` | string | Subtopic reward label snapshot |
| `startedAt`, `lastPlayedAt`, `completedAt` | date | Timeline |
| `itemStates` | array | Per-item attempt/completion data |

Each `itemStates` entry tracks:

- `itemId`
- `itemStableId`
- `templateType`
- `status`
- `attempts`
- `correctAttempts`
- `completed`
- `starsEarned`
- `firstCompletedAt`
- `lastCompletedAt`
- `lastAttemptAt`
- `lastResult`
- `lastAnswer`

## `learning_attempt`

Append-only answer/activity history.

Important fields:

| Field | Type | Notes |
| --- | --- | --- |
| `userId`, `userName` | ref + string | Learner |
| `topicId`, `topicStableId` | ref + string | Topic snapshot |
| `subtopicId`, `subtopicStableId` | ref + string | Lesson snapshot |
| `itemId`, `itemStableId` | ref + string | Item snapshot |
| `templateType` | string | Item template |
| `attemptType` | `answer` or `activity` | Scene completion vs question attempt |
| `answer` | mixed | Normalized submitted payload |
| `isCorrect` | boolean or null | Null for scene completion |
| `completed` | boolean | Whether that attempt completed the item |
| `starsAwarded` | number | Usually only first correct completion |
| `feedbackMessage` | string | Saved feedback |
| `createdAt`, `updatedAt` | date | Mongoose timestamps |

## Themes, Rewards, and Art Fields

Topic and subtopic both embed the shared structures from `models/learning_shared.js`.

### `theme`

Theme fields:

- `accentColor`
- `accentColorSoft`
- `backgroundStart`
- `backgroundEnd`
- `glowColor`
- `backgroundImageUrl`
- `pattern`
- `iconArt`
- `mascotArt`
- `badgeArt`

At runtime:

- topic and subtopic theme values are merged
- subtopic values override topic values
- background image is applied through CSS

### `reward`

Reward fields:

- `label`
- `description`
- `stickerArt`

In the learner UI, the subtopic reward is what matters:

- topic page sticker shelf
- lesson completion screen
- progress summary text

## Supported Item Templates

## 1. `scene`

Purpose:

- unscored interactive activity
- used as a warm-up or exploration step

Runtime notes:

- `kind` becomes `activity`
- `points` is forced to `0`
- clicking `Next` submits `{ action: "complete" }`

Allowed `sceneType` values:

- `atom_play`
- `molecule_builder`
- `particle_party`

Authoring fields in CMS:

- template type
- title
- blurb/helper text
- `sceneType`
- `sceneSlotCount`
- `scenePieces`
- `goodFeedback` (stored as `completeMessage`)

Important current limitation:

The scene system is **not** a generic scene builder. The current player contains three hardcoded mini-games:

- `atom_play`
  - chemistry-specific atom/electron toy
- `molecule_builder`
  - chemistry-specific molecule builder
  - uses `scenePieces` and `sceneSlotCount`
- `particle_party`
  - matter-state particle toy

Also important:

- `sceneBodyText`
- `sceneHintText`
- `sceneExampleText`
- item `prompt`

are stored in the database, but the current player mostly uses hardcoded scene copy instead of rendering those fields. Today, the fields that actually change scene behavior are mainly:

- `sceneType`
- `scenePieces` for `molecule_builder`
- `sceneSlotCount` for `molecule_builder`
- `completeMessage`

Use `scene` only when that current hardcoded behavior fits your lesson.

## 2. `single_choice`

Purpose:

- one correct answer out of 2 to 6 options

Authoring rules:

- at least 2 options are required
- each option needs:
  - `key`
  - `label`
  - optional art
- `correctOptionKey` must exactly match one option key
- choices can be shuffled per playthrough

Good use cases:

- vocabulary matching
- identify the right picture
- simple concept checks

Resource prep:

- prepare option labels
- prepare option art for each answer if visual

## 3. `count_target`

Purpose:

- learner increments/decrements until exact target count is reached

Authoring rules:

- `targetCount` must be `<= maxCount`
- `targetCount` range: `0-30`
- `maxCount` range: `1-40`

Display modes:

- `tokens`
  - generic repeated tokens
  - can use custom `countTokenArt`
- `atom`
  - atom/electron widget
  - best for chemistry counting
  - custom token art is not used in this mode

Good use cases:

- count clouds, stars, animals, raindrops, fruit
- count electrons in chemistry mode

Resource prep:

- target number
- max number
- label, like `Clouds` or `Stars`
- optional token art if using token mode

## 4. `builder_sequence`

Purpose:

- learner places pieces into slots to match an exact ordered sequence

Authoring rules:

- `builderTargetSequence` is required
- `builderSlotCount` must be at least the target length
- slot count range: `2-8`
- the available `builderPieces` must contain every required target value, including duplicates
- pieces and target sequence are entered as comma-separated or newline-separated values

Display modes:

- `tokens`
  - generic chips for text/emoji-like sequences
- `atoms`
  - best when pieces are short atomic-style labels like `H`, `O`, `C`, `Na`
  - longer values fall back to token chips anyway

Good use cases:

- spell a sequence
- arrange process steps
- build weather cycles from icons or words
- build simple molecules

Resource prep:

- available piece list
- exact target sequence
- choice whether to shuffle the pieces

## 5. `state_change`

Purpose:

- learner heats/cools until a target state is reached

Supported states:

- `solid`
- `liquid`
- `gas`

Authoring rules:

- pick `startState`
- pick `targetState`
- optionally hide the cool button

Important runtime behavior:

- there is no separate `Check` button
- every heat/cool click immediately submits the current state
- this template is currently specialized to matter-state lessons

Good use cases:

- solids/liquids/gases
- phase-change lessons

Not a good fit for arbitrary non-state topics unless you also want the particle-box metaphor.

## Which Templates Are Truly Generic?

### Good for almost any topic

- `single_choice`
- `count_target` in `tokens` mode
- `builder_sequence` in `tokens` mode

### Good mainly for science or chemistry-style topics

- `scene.atom_play`
- `scene.molecule_builder`
- `scene.particle_party`
- `count_target` in `atom` mode
- `builder_sequence` in `atoms` mode
- `state_change`

## Resource Management

This is the part to understand before preparing a new topic.

## Art kinds

Every art field uses one of three kinds:

### 1. `builtin`

This is the most important mode.

`builtin` means:

- a hardcoded system art key from the player, or
- an uploaded SVG stored in `learning_art_asset`

This is the preferred choice for reusable assets.

### 2. `emoji`

Useful for:

- quick placeholder art
- low-effort simple icons
- early drafts

### 3. `image`

Useful for:

- one-off images not worth uploading as SVG
- existing hosted image files

Accepted URL styles are restricted to safe values such as:

- `https://...`
- `/img/...`
- `./relative-path`

Image URLs are **not** centrally managed by the art library.

## Uploaded SVG art

Uploaded SVGs are managed from:

- `/admin/learning/art`
- or the upload modal inside `/admin/learning`

Upload behavior:

- max file size is `1MB`
- SVG markup is sanitized before saving
- scripts are stripped
- the saved asset gets a unique `key`
- reserved system keys cannot be overwritten
- assets are stored in MongoDB, not on disk

The CMS then exposes the uploaded SVG by its `key` everywhere a built-in art value can be used.

Example:

1. Upload `cloud-happy.svg` with key `cloud-happy`
2. In a topic, subtopic, reward, or choice option, select:
   - kind: `Built-in art`
   - value: `cloud-happy`

The player will then render the stored SVG.

Important current limitation:

- there is upload UI
- there is **no delete/edit UI** for art assets in the current CMS

If you need art cleanup, that currently requires direct database work or new code.

## Current system built-in art keys

These are already supported by the player even without uploads:

`mascot`, `chemistry`, `atom`, `molecule`, `mixture`, `states`, `water`, `weather`, `cloud`, `sun`, `rain`, `snow`, `wind`, `storm`, `lightning`, `rainbow`, `star`, `solid`, `liquid`, `gas`, `solid-box`, `liquid-box`, `gas-box`, `molecule-h2o`, `molecule-co2`, `molecule-o2`, `colors`, `animals`, `space`, `numbers`

The library page `/admin/learning/art` is the easiest way to inspect them visually.

## What Resources To Prepare Before Building A Topic

For each new topic, prepare this checklist first.

### Topic-level resource checklist

- topic title
- topic slug
- short description
- sort order
- publish plan (`draft` first, then `published`)
- color palette
  - accent
  - soft accent
  - background start
  - background end
  - glow color
- optional background image URL
- topic icon
- lesson mascot
- optional badge art

### Subtopic-level resource checklist

- subtopic title
- subtopic slug
- short description
- estimated minutes
- theme overrides, if any
- reward label
- reward description
- reward sticker art
- subtopic icon and mascot if different from topic defaults

### Item-level resource checklist

For every item, decide:

- template type
- title
- order
- prompt
- helper text
- blurb
- star value
- success feedback
- failure feedback

Then prepare template-specific resources:

#### For `single_choice`

- 2 to 6 option labels
- one correct key
- art for each option if visual

#### For `count_target`

- target count
- max count
- counter label
- token art if using `tokens` mode

#### For `builder_sequence`

- piece pool
- exact target sequence
- slot count
- shuffle yes/no

#### For `state_change`

- start state
- target state
- whether cooling should be allowed

#### For `scene`

- choose the specific built-in mini-game
- if using `molecule_builder`, prepare:
  - piece list
  - slot count

## How To Add A New Topic

## Step 1. Upload reusable art first

If your topic needs custom reusable art:

1. Open `/admin/learning/art`
2. Upload the SVGs you want to reuse
3. Choose short, stable keys
4. Write descriptions so future editors know where each asset is meant to be used

Do this first so the art picker is ready when you create topics, subtopics, rewards, and answer options.

## Step 2. Create the topic

In `/admin/learning`:

1. Click `New topic`
2. Fill:
   - title
   - slug
   - description
   - order
   - status
   - theme fields
   - icon/mascot/badge art
   - optional topic reward fields
3. Save

Notes:

- If slug is blank, it is generated from the title.
- If the slug already exists, the service generates a unique variant.
- The service generates `stableId` automatically.

## Step 3. Create the subtopics

For each lesson:

1. Click `New subtopic`
2. Select the parent topic
3. Fill:
   - title
   - slug
   - description
   - order
   - estimated minutes
   - status
   - lesson theme overrides
   - lesson reward label, description, and sticker art
4. Save

Recommendations:

- Keep one subtopic focused on one learning outcome
- Give each subtopic its own reward sticker so the topic page sticker shelf feels intentional

## Step 4. Create template profiles for repeated patterns

This step is optional but highly recommended if your topic repeats the same lesson pattern.

Example reusable patterns:

- "Pick the correct image"
- "Count the clouds"
- "Arrange the 3-step cycle"

Workflow:

1. Click `New template`
2. Build the generic item
3. Save it as a template profile
4. Apply it into new items as needed

Important:

- template profiles are not linked live
- they only copy values into the item form at the moment you apply them

## Step 5. Create the lesson items

For each subtopic:

1. Click `New item`
2. Select the parent subtopic
3. Choose the template type
4. Fill the generic item fields
5. Fill the template-specific config
6. Save
7. Repeat until the lesson is complete

Typical lesson pattern:

1. one opening `scene` activity
2. two to four question items
3. reward unlock at full completion

That pattern is what the built-in chemistry seed also uses.

## Step 6. Preview before publishing

Use the CMS preview links or manually add `?preview=1`.

Check:

- lesson sequence order
- visual theme
- art rendering
- answer correctness
- star totals
- reward unlock
- whether any draft-only content is still hidden from non-preview users

Because preview does not save progress, it is safe for repeated test runs.

## Step 7. Publish

Publishing requires:

- topic status: `published`
- subtopic status: `published`
- item status: `published`

If a topic is published but its subtopics or items are still draft, those draft entries will not appear to normal learners.

## How To Add New Resources

There are three practical ways to add resources:

### Option 1. Upload SVGs into the art library

Use this when:

- the asset should be reusable in many places
- you want it searchable in the CMS picker
- you want the asset stored in the database with the lesson system

Best for:

- icons
- stickers
- answer illustrations
- custom thematic symbols

### Option 2. Use system built-in art

Use this when:

- one of the existing keys already fits
- you want the fastest setup

Best for:

- chemistry
- weather
- states of matter
- generic categories like space, animals, colors, numbers

### Option 3. Use image URLs

Use this when:

- the art is one-off
- you already have a hosted file
- you do not need it searchable in the art library

Best for:

- externally managed lesson images
- existing site assets in `public/img` or similar

## Worked Planning Example

If you wanted to build a new topic called `Weather`, one practical plan would be:

### Topic

- title: `Weather`
- slug: `weather`
- icon art: `weather`
- mascot art: uploaded SVG like `cloud-guide`
- background image: optional sky background

### Subtopics

- `clouds`
- `rain`
- `storms`

### Example `clouds` lesson

1. `single_choice`
   - "Which picture shows a cloud?"
2. `count_target` in `tokens` mode
   - "Add exactly 4 clouds"
   - token art: built-in `cloud` or uploaded SVG `cloud-happy`
3. `builder_sequence` in `tokens` mode
   - order the weather cycle: `Sun`, `Cloud`, `Rain`
4. `single_choice`
   - choose what clouds are made of

This example works well because it uses the templates that are the most topic-agnostic.

## Non-Obvious But Important Behavior

## 1. The chemistry demo seed will recreate missing seed content

`learningService.ensureSeedData()` auto-creates the chemistry topic, its subtopics, and its items if they are missing.

That means:

- on a fresh database, the chemistry demo appears automatically
- if you delete the seeded chemistry records entirely, they will come back on the next page load
- if you edit the seeded records instead of deleting them, the service does not overwrite your edits because it only creates missing documents

## 2. Changing a topic or subtopic slug cascades references

The service updates related records when topic/subtopic slugs or parent relationships change:

- subtopics
- items
- progress docs
- attempts

So editors should use the CMS save flow instead of manual DB edits whenever possible.

## 3. Deleting content deletes learner history in that scope

- deleting a topic deletes its subtopics, items, progress, and attempts
- deleting a subtopic deletes its items, progress, and attempts
- deleting an item deletes its attempts and removes its progress state from affected subtopic progress docs

Treat delete operations as destructive.

## 4. Several stored fields are not fully surfaced yet

These fields exist, but are not meaningfully used by the current learner UI:

- `topic.shortLabel`
- topic `reward`
- topic/subtopic `badgeArt`
- topic/subtopic `theme.pattern`
- scene `bodyText`
- scene `hintText`
- scene `exampleText`
- scene item `prompt`

You can still fill them for future compatibility, but do not expect visible learner changes today.

## 5. Template profiles are not inheritance

Template profiles save time in the CMS, but they are not a live shared source after item creation.

If you change a template profile later:

- future items can use the new version
- existing items stay exactly as they were saved

## Practical Authoring Advice

- Start every new topic in `draft`.
- Upload shared art before building content.
- Prefer `builtin` art for anything reused across multiple lessons.
- Use `image` only for one-off assets or already-hosted files.
- Keep lesson rewards at the subtopic level, because that is what learners actually unlock.
- Use the most generic templates for non-science topics:
  - `single_choice`
  - `count_target` in token mode
  - `builder_sequence` in token mode
- Use scene and state-change templates only when their hardcoded metaphors fit the topic.
- Preview every lesson as an admin before publishing.

## Quick Start Summary

If someone only reads one section, it should be this:

1. Upload any reusable SVGs in `/admin/learning/art`
2. Create a topic in `/admin/learning`
3. Create one or more subtopics under it
4. Create items inside each subtopic
5. Use template profiles only as reusable form presets
6. Preview lessons with `?preview=1`
7. Publish topic, subtopics, and items when ready

That is the full authoring workflow for shipping a brand-new Learning Lab topic.
