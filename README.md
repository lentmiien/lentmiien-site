# My Personal Website Project

Welcome! This repository holds the codebase for my personal website—a dynamic platform that integrates my interests in software development, AI, data management, and practical productivity tools. It serves as my digital portfolio and as an innovative workspace to explore sophisticated web technologies, AI integrations, and daily-life applications.

## Features

### AI-Powered Chat (`Chat5`)

- **Real-Time Communication:** Leveraging `socket.io` for seamless, instant data transmissions between the client and server.
- **Markdown Editor Input:** Input messages with Markdown support for clearer formatting and structured interactions.
- **Multi-Provider AI Integration:** Compatible with advanced language models via OpenAI, Anthropic, Google, Groq, and LMStudio APIs.
- **Knowledge Database:** Store, edit, and inject curated knowledge directly into AI-assisted conversations.
- **Redact Functionality:** Easily redact sensitive information within chats to emphasize privacy.
- **Upcoming Improvements:** Working on an improved message system to better manage complex, multi-chunk AI responses (e.g., OpenAI's Assistants API). Google's API multi-chunk handling is also a consideration (lower priority).

### Meal Planning & Cooking Analytics

- **Cooking Calendar:** Easily manage cooking schedules, meal plans, recipe links, and family meal requests.
- **Advanced Cooking Analytics:** Visually identify cooking trends and frequency of meal preparations through an intuitive analytics dashboard.

### Budget & Financial Management

- **Budget Tracker:** Efficiently track transactions, manage recurring payments, and visualize financial trends.
- **Receipt & Payroll Databases:** Precisely store transaction and payroll information. AI-driven OCR functionality automatically extracts key data from uploaded receipt images.

### Document & Product Utilities

- **PDF-to-Image Converter:** Convert PDF documents directly to images in-browser.
- **AI-powered Product Database:** Generate concise and accurate AI-assisted product summaries, ideal for customs documentation and e-commerce requirements.

### Health & Wellness Management

- **Health Tracker:** Track fitness routines, dietary information, and various health metrics comprehensively.

### Personal & Informational Pages

- **About Page:** Learn more about my development journey and the objectives behind this website.

### Dropbox Backup System (Images)

- Automatically backs up AI-generated and user-uploaded images to Dropbox, providing secure cloud storage and easy accessibility.

### Integrated Calendar (Early Testing)

- A new calendar functionality is currently in early-stage testing on the main branch. It's intended as a foundation for future improvements and user-experience assessments.

## Technologies Used

- **Backend:** Node.js with Express.js framework
- **Real-time Communication:** Socket.io
- **Database:** MongoDB with Mongoose schema management
- **Frontend:** Pug templates, CSS, JavaScript (planned Vue.js integration in future updates)
- **AI Integrations:** APIs from OpenAI, Anthropic, Google, Groq, and Local LMStudio models
- **File & Image Processing:** PDF-to-image conversion tools, OCR-based receipt extraction, and cloud-based backups via Dropbox API

## Getting Started

Follow these quick steps to set up and run the project locally:

1. **Clone the repository**  
    ```bash
    git clone https://github.com/lentmiien/lentmiien-site.git
    ```

2. **Install dependencies**  
    ```bash
    npm install
    ```

3. **Configure environment variables**  
    Refer to the provided `env_sample` file for required variables.

4. **Start the server**  
    ```bash
    npm start
    ```

Now you should find the website accessible in your browser at `http://localhost:3000` (or the port you've specified).

## Planned Future Improvements

- **Chat Enhancements:** Update `Chat5` to handle complex multi-chunk AI responses more efficiently.
- **Frontend Improvements:** Transition frontend to Vue.js for enhanced reactivity and maintainability.
- **Advanced Data Security:** Implement encryption to protect sensitive database information.
- **Custom ML Models:** Build specialized machine learning models tailored to enhance website functionalities.
- **Calendar Refinement:** Develop and optimize the currently-in-testing calendar functionality based on usage experience and feedback.

## Contributions & Feedback

Though primarily personal, I warmly welcome contributions, suggestions, bug reports, or general feedback. Feel free to open an issue or contribute via pull requests.

## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for details.

## Acknowledgements

- **AI Providers:** OpenAI, Anthropic, Google, Groq, LMStudio for advanced AI model support.
- **Cloud Backup:** Dropbox API for secure storage solutions.
- **Real-Time Interactivity:** Socket.io for live, real-time communication capabilities.

---

**Thank you for exploring my project!** This website continues to develop alongside my ongoing learning, growth, and experimentation as a software developer. I hope it serves as inspiration or provides helpful guidance for your projects.