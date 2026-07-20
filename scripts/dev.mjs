#!/usr/bin/env node
import { runStack } from "./stack-runner.mjs";

await runStack({ mode: "development", args: process.argv.slice(2) });
