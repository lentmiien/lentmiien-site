This reference manual provides guidelines and best practices for developing web applications using Node.js, Express, Socket.io, MongoDB, and Pug templates. It is designed to help you structure your project in a modular and maintainable manner, allowing for easy addition of new functionality and scalability.

---

## Table of Contents

- [Introduction](#introduction)
- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Coding Conventions](#coding-conventions)
- [Services](#services)
  - [Creating a Service](#creating-a-service)
  - [Using Services](#using-services)
  - [Combining Services](#combining-services)
- [Routes and Controllers](#routes-and-controllers)
  - [Defining Routes](#defining-routes)
  - [Implementing Controllers](#implementing-controllers)
- [Socket.io Communication](#socketio-communication)
  - [Setting Up Socket.io](#setting-up-socketio)
  - [Handling Events](#handling-events)
- [Pug Templates](#pug-templates)
  - [Structuring Templates](#structuring-templates)
  - [Rendering Views](#rendering-views)
- [Database Interaction with MongoDB](#database-interaction-with-mongodb)
  - [Defining Models](#defining-models)
  - [Interacting with the Database](#interacting-with-the-database)
- [Adding New Functionality](#adding-new-functionality)
- [Refactoring and Maintenance](#refactoring-and-maintenance)
- [Best Practices](#best-practices)
- [Conclusion](#conclusion)

---

## Introduction

This manual outlines the framework for building Node.js web applications with a focus on modularity and scalability. By following this guide, you can ensure your application is well-organized, maintainable, and easy to extend with new features.

## Architecture Overview

The application follows a modular architecture that separates concerns into distinct layers:

- **Services**: Encapsulate business logic and interact with the database.
- **Routes and Controllers**: Handle HTTP requests, process input, invoke services, and render responses.
- **Socket.io**: Manages real-time communication between the client and server.
- **Views (Pug Templates)**: Define the structure of the user interface.
- **Database (MongoDB)**: Stores and retrieves application data.

![Architecture Diagram](./architecture-diagram.png)

## Project Structure

Organize your project files and directories as follows:

```
project-root/
├── controllers/
│   ├── exampleController.js
│   └── ...
├── models/
│   ├── exampleModel.js
│   └── ...
├── routes/
│   ├── exampleRoute.js
│   └── ...
├── services/
│   ├── exampleService.js
│   └── ...
├── sockets/
│   ├── exampleSocket.js
│   └── ...
├── views/
│   ├── layout.pug
│   ├── index.pug
│   └── ...
├── public/
│   ├── css/
│   ├── js/
│   └── images/
├── app.js
├── package.json
└── README.md
```

- **controllers/**: Controller modules for handling request logic.
- **models/**: Mongoose models for MongoDB collections.
- **routes/**: Route definitions mapping URLs to controllers.
- **services/**: Business logic and data manipulation.
- **sockets/**: Socket.io event handlers.
- **views/**: Pug templates for rendering views.
- **public/**: Static assets (CSS, JS, images).
- **app.js**: Entry point of the application.

## Coding Conventions

- **ES6 Syntax**: Use modern JavaScript features for cleaner code.
- **Module Imports**: Use `const` or `import` for dependencies.
- **Async/Await**: Handle asynchronous operations with `async`/`await`.
- **Error Handling**: Implement proper error handling and logging.
- **Naming Conventions**:
  - Files: `camelCase.js`
  - Classes/Constructors: `PascalCase`
  - Variables/Functions: `camelCase`
- **Comments**: Use JSDoc comments for functions and classes.

## Services

Services are at the core of the application logic. They provide methods to perform operations such as data retrieval, manipulation, and business rules enforcement.

### Creating a Service

1. **Create a new file** in the `services/` directory, e.g., `userService.js`.
2. **Define service methods** that perform specific tasks.

```javascript
// services/userService.js

const UserModel = require('../models/userModel');

const userService = {
  async createUser(userData) {
    // Business logic for creating a user
    const user = new UserModel(userData);
    return await user.save();
  },
  async getUserById(userId) {
    // Business logic for retrieving a user
    return await UserModel.findById(userId);
  },
  // Add more methods as needed
};

module.exports = userService;
```

### Using Services

Import and utilize the service methods in controllers or other services.

```javascript
// controllers/userController.js

const userService = require('../services/userService');

async function createUserController(req, res, next) {
  try {
    const user = await userService.createUser(req.body);
    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
}
```

### Combining Services

Create a new service that utilizes methods from existing services to perform more complex operations.

```javascript
// services/analyticsService.js

const userService = require('./userService');
const orderService = require('./orderService');

const analyticsService = {
  async getUserOrderStats(userId) {
    const user = await userService.getUserById(userId);
    const orders = await orderService.getOrdersByUserId(userId);
    // Process and combine data from both services
    return {
      user,
      totalOrders: orders.length,
      // Additional analytics
    };
  },
};

module.exports = analyticsService;
```

## Routes and Controllers

Routes map HTTP requests to controller functions that handle the request logic.

### Defining Routes

1. **Create a new route file** in the `routes/` directory, e.g., `userRoute.js`.
2. **Define route paths** and associate them with controller functions.

```javascript
// routes/userRoute.js

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

router.post('/users', userController.createUserController);
router.get('/users/:id', userController.getUserController);

module.exports = router;
```

### Implementing Controllers

Controllers process incoming requests, interact with services, and send responses.

```javascript
// controllers/userController.js

const userService = require('../services/userService');

async function createUserController(req, res, next) {
  try {
    const user = await userService.createUser(req.body);
    res.status(201).render('userProfile', { user });
  } catch (error) {
    next(error);
  }
}

async function getUserController(req, res, next) {
  try {
    const user = await userService.getUserById(req.params.id);
    res.render('userProfile', { user });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createUserController,
  getUserController,
};
```

## Socket.io Communication

Socket.io enables real-time bidirectional communication between the client and server.

### Setting Up Socket.io

1. **Initialize Socket.io** in your main application file.

```javascript
// app.js

const http = require('http');
const socketIo = require('socket.io');
const app = require('./app'); // Express app

const server = http.createServer(app);
const io = socketIo(server);

require('./sockets/socketHandler')(io);

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
```

### Handling Events

Define event handlers for Socket.io in the `sockets/` directory.

```javascript
// sockets/socketHandler.js

module.exports = function(io) {
  io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('joinRoom', async (roomId) => {
      socket.join(roomId);
      // Notify others in the room
      socket.to(roomId).emit('userJoined', socket.id);
    });

    socket.on('sendMessage', async (data) => {
      // Handle incoming message
      io.to(data.roomId).emit('receiveMessage', data.message);
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });
};
```

## Pug Templates

Pug is a templating engine used to generate HTML views.

### Structuring Templates

Organize templates in the `views/` directory.

- **Layout Template**: `layout.pug` defines the HTML skeleton.
- **Partial Templates**: Reusable components like headers and footers.
- **Page Templates**: Specific pages like `index.pug`, `userProfile.pug`.

Example `layout.pug`:

```pug
doctype html
html
  head
    title= title
    link(rel='stylesheet', href='/css/style.css')
  body
    block content
    script(src='/js/main.js')
```

### Rendering Views

In controllers, render views using `res.render()`.

```javascript
// controllers/homeController.js

function homePageController(req, res) {
  res.render('index', { title: 'Home Page' });
}

module.exports = {
  homePageController,
};
```

## Database Interaction with MongoDB

Use Mongoose for object data modeling (ODM) to interact with MongoDB.

### Defining Models

Create Mongoose models in the `models/` directory.

```javascript
// models/userModel.js

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', userSchema);
```

### Interacting with the Database

Perform CRUD operations within services.

```javascript
// services/userService.js

const UserModel = require('../models/userModel');

async function createUser(userData) {
  const user = new UserModel(userData);
  return await user.save();
}

async function getUserById(userId) {
  return await UserModel.findById(userId);
}

module.exports = {
  createUser,
  getUserById,
};
```

## Adding New Functionality

To add new functionality:

1. **Create a Service**: Implement the business logic.
2. **Define Routes**: Map URLs to controller functions.
3. **Implement Controllers**: Handle input and invoke service methods.
4. **Set Up Socket.io Events** (if needed): Handle real-time communication.
5. **Create Views**: Design Pug templates for rendering pages.
6. **Update Models** (if needed): Define new data structures.
7. **Integrate**: Ensure all components work together seamlessly.

## Refactoring and Maintenance

- **Modularize Code**: Keep code separated by functionality.
- **Update Documentation**: Maintain the reference manual and inline comments.
- **Code Reviews**: Regularly review code for improvements.
- **Testing**: Implement unit and integration tests.
- **Dependency Updates**: Keep npm packages up to date.

## Best Practices

- **Single Responsibility Principle**: Each module or function should have one responsibility.
- **DRY (Don't Repeat Yourself)**: Reuse code through services and helper functions.
- **Error Handling**: Catch and handle errors gracefully.
- **Security**: Sanitize inputs, use HTTPS, and protect against common vulnerabilities.
- **Performance**: Optimize database queries and minimize server load.
- **Scalability**: Design with future growth in mind.

## Conclusion

This framework provides a solid foundation for building modular and maintainable web applications. By following the guidelines and structure outlined in this manual, you can efficiently develop new features, improve existing functionality, and ensure your codebase remains clean and organized.

---

**Note**: This reference manual is intended to be generic and adaptable to various projects using similar technologies. Customize it as needed to suit the specific requirements of your application.