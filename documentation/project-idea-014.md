# Project Idea 014 – Curated AI Courseware & Learning Agent

## Goal
Build an AI tutor that curates lessons, quizzes, and follow-up content tailored to personal interests. The agent should select topics from the knowledge base, generate teaching materials, collect feedback, and adjust future sessions accordingly.

## Scope Overview
- Model learner profiles with interests, skill levels, and feedback history.
- Create a content pipeline that sources prompts/documents from `documentation/`, `reference_material/`, and external feeds.
- Implement an agent workflow that schedules lessons, generates materials (slides, summaries, quizzes), gathers responses, and updates the learner profile.
- Provide UI for reviewing lessons, taking quizzes, and rating usefulness.

## Key Code Touchpoints
- New models (`LearnerProfile`, `CoursewareLesson`, `QuizResult`).
- `services/coursewareService.js`, `services/agentService.js` (extend with tutor agent).
- UI under `views/courseware/*.pug`, `routes/courseware.js`, `controllers/coursewarecontroller.js`.
- Integration with `documentation/README-Prompts.md`, knowledge graph (Project Idea 011).
- Notification hooks (Mailgun) for scheduled lessons.

## Implementation Notes
1. **Learner modelling** – Capture explicit interests and inferred preferences (e.g., topics read in Chat5). Store a decay-based history to avoid repetition.
2. **Content generation** – Use Chat5 prompt templates to create lesson outlines and quizzes. Cache generated content for review and auditing.
3. **Session workflow** – Scheduler triggers a tutor agent to assemble the next lesson, send notifications, and record completion metrics.
4. **Feedback loop** – Render quizzes, collect answers, evaluate using rubric scripts, and adjust future topic selection based on performance/feedback.
5. **Analytics** – Track progress over time, surface achievements, and feed data into the Master Feed or dashboards.

## Dependencies / Follow-ups
- Relies on Project Idea 011’s knowledge graph for topic discovery and Project Idea 009/010’s agent framework.
- Could publish lesson summaries to the public portfolio (Project Idea 015) once curated.
