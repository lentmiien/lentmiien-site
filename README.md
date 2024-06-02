# My Personal Website Project

Welcome to the repository for my personal website, a platform where I blend my passion for programming with my personal interests. This project serves not only as my digital portfolio but also as a playground for experimenting with new web technologies and features. From a dynamic chat application inspired by ChatGPT to a comprehensive cooking calendar for meal planning, this website is where I bring my innovative ideas to life.

## Features

- **Chat4:** An enhanced chat feature that supports model selection, branching conversations, and integrates directly with a knowledge database.
  - **Redact Functionality:** Provides the ability to redact information within the chat interface to ensure privacy.
  - **OpenAI Batch API Support:** Integrated support for OpenAI's batch API, offering a 50% discount on requests, though with slower response times.
- **Cooking Calendar:** Allows for meal planning, managing cooking schedules, and handling family meal requests with links to recipes.
- **Knowledge Database:** A central repository for storing valuable information, including recipes and chat logs, which can be edited and injected into Chat3 conversations.
- **About Page:** Provides insight into my journey as a programmer and the goals of this website.
- **Budget Tracker:** A tool for managing personal finances with features for recurring transactions and trend analysis.
- **Health Tracker:** A comprehensive system for tracking wellness metrics, including exercise, diet, and health metrics.

## Technologies Used

- **Back-End:** Node.js, Express
- **Database:** MongoDB with Mongoose for schema management
- **Front-End:** Pug templates, CSS, JavaScript
- **APIs:** OpenAI for Chat4 enhancements

## Getting Started

To get a local copy up and running, follow these simple steps:

1. Clone the repository:
    ```sh
    git clone https://github.com/lentmiien/lentmiien-site.git
    ```
2. Install NPM packages:
    ```sh
    npm install
    ```
3. Configure your environment variables (refer to `env_sample` for required variables).
4. Start the server:
    ```sh
    npm start
    ```

The application should now be running on `localhost:3000` (or another port specified in your environment variables).

## Future Improvements

- **Switch User Side to a VUE App:** Enhance frontend responsiveness and user experience by transitioning to a VUE application.
- **Agent Interface Powered by OpenAI's API:** Develop an intelligent agent interface leveraging OpenAI's API for more dynamic user interactions.
- **Encrypt Database Content:** Implement encryption for stored data to ensure user information is secure.
- **Custom Machine Learning Model:** Work on a custom ML model tailored to the specific needs of this web app to introduce unique functionalities or enhance performance.

## Contribution

While this project is a personal journey into web development, contributions, suggestions, and feedback are welcome. If you have ideas on how to improve this project or want to report a bug, please feel free to open an issue or submit a pull request.

## License

Distributed under the MIT License. See `LICENSE` for more information.

## Acknowledgements

- OpenAI for providing the ChatGPT model for educational and development use.

---

Thank you for visiting my project! This website is a continuous work in progress, reflecting my learning and growth as a developer. I hope it serves as inspiration or a resource for your own projects.