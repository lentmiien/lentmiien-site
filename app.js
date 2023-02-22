const path = require('path');
const express = require("express");
const app = express();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.get("/", (req, res) => res.render("index"));

app.listen(8080, () => console.log("Server running on port 8080"));