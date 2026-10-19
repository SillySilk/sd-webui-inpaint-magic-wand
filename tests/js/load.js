"use strict";
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "..", "javascript");
const files = fs.readdirSync(dir).filter((f) => /^imw_.*\.js$/.test(f)).sort();
let IMW = {};
for (const f of files) IMW = require(path.join(dir, f));
module.exports = IMW;
