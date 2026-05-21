# Project Context: What To Prepare

This document outlines the architectural decisions and implementation history of the "What To Prepare" meal planning app.

## Core Objective
To build an intelligent, context-aware meal brainstorming application that removes the daily friction of deciding what to cook, specifically tailored for Indian families.

## Implementation History

### Phase 1: Foundation & UI
- Built a responsive, mobile-friendly interface using Vanilla HTML, CSS, and JS.
- Implemented a "Glassmorphism" aesthetic with a dashboard, family setup modal, and daily chat interface.
- Created local state management using the browser's `localStorage` to save family profiles, dietary restrictions, and meal history.

### Phase 2: AI Integration (Groq)
- Initially used local Gemini models, but pivoted to using the **Groq API** (`llama-3.1-8b-instant`) for lightning-fast, OpenAI-compatible chat responses.
- Implemented an `app.js` logic layer that aggregates the user's family profile (likes, dislikes, health notes) and recent meal history into a structured `systemPrompt`.

### Phase 3: Fridge Inventory & Continuous Brainstorming
- Replaced the rigid "One-off Suggestion" flow with a continuous **Brainstorming Chat**.
- Built a **Fridge Inventory System**: Users can add items (e.g., "1L milk") via the dashboard UI or directly via natural language in the chat.
- **Agentic Capability**: The LLM is instructed via the system prompt to output specific tags like `[ADD_FRIDGE: x]` or `[REMOVE_FRIDGE: y]`. The frontend regex-parses these tags from the AI's response to dynamically update the UI in the background, allowing the user to seamlessly use up or restock ingredients through conversation.

### Phase 4: Local Database Migration
- Migrated away from volatile browser `localStorage` to a lightweight, persistent local database.
- Created `server.js`: A simple Node.js HTTP server running on port 3001 that reads and writes to `db.json`.
- Refactored `app.js` to initialize state by fetching from `localhost:3001` on load, and asynchronously syncing updates to the backend via POST requests, ensuring data survives across different versions/folders of the app.

## Next Architectural Pivot: CSP Integration
Currently, the LLM handles both the constraint solving and the conversational reasoning. However, LLMs are notoriously poor at strict combinatorial optimization (e.g., finding a meal that *exactly* uses X, strictly avoids Y, and takes Z minutes).
**Future Plan:** Adopt a Neuro-Symbolic architecture.
1. Use a deterministic **Constraint Satisfaction Problem (CSP) Engine** (like Google OR-Tools or custom Python logic) running in the backend to calculate the mathematically perfect recipe options based on fridge items and family constraints.
2. Pass those strict solutions to the LLM.
3. The LLM acts purely as the "Explainer," communicating the CSP's choices to the user in a natural, empathetic tone.
