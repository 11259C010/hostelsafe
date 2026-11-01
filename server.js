require("dotenv").config();
const express = require("express");
const app = express();
app.set("trust proxy", 1);
app.use(process.env.BASE_PATH || "/", require("./router"));
app.listen(process.env.PORT || 3000, () => console.log("HostelSafe running on port " + (process.env.PORT || 3000)));
