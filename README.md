# What To Prepare 🍲

A smart, AI-powered meal planning application that helps families brainstorm what to cook based on their dietary restrictions, recent meals, and what's currently in their fridge.

## Features

- **Family Profiles**: Add members with specific dietary restrictions (e.g., vegetarian, low-sodium), likes, dislikes, and health notes.
- **Smart Fridge Inventory**: Keep track of ingredients you have on hand. Add or remove items directly through the UI or just by chatting with the AI.
- **AI Brainstorming Chat**: A continuous conversational interface powered by the Groq API (Llama 3). Ask the AI "What should I make for dinner?" and it automatically considers your family's constraints and your current fridge inventory.
- **Meal History**: Log what you made to prevent the AI from suggesting repeats.
- **Local Database**: Runs a lightweight Node.js server to save all data to a local `db.json` file, ensuring your data persists across app updates without needing a complex cloud setup.

## Getting Started

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ananthasail18/What_to_prepare.git
   cd What_to_prepare
   ```

2. **Start the local database server:**
   ```bash
   node server.js
   ```
   *This runs on port 3001 and saves your data to `db.json`.*

3. **Serve the Frontend:**
   Open a new terminal and run:
   ```bash
   npx serve .
   ```
   *Navigate to `http://localhost:3000` to view the app.*

4. **Add your API Key:**
   Open `app.js` and replace `YOUR_GROQ_API_KEY_HERE` with your actual Groq API key to enable the AI features.

## Tech Stack
- Frontend: Vanilla HTML, CSS (Glassmorphism design), JavaScript
- Backend (DB): Node.js (custom micro-server writing to JSON)
- AI Integration: Groq API (`llama-3.1-8b-instant`)

## Next Steps / Roadmap
- Implement a full Constraint Satisfaction Problem (CSP) solver engine to pre-filter recipes before passing them to the LLM for explanations.
