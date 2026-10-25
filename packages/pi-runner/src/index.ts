// Self-contained sources shipped in each downloadable package. No unpublished runtime dependency.
// Edit templates/*.ts (typechecked against Pi's extension API), then run `corepack pnpm templates`.
export {
  workerSource,
  workerSource as runnerSource,
  extensionSource,
  calcSource,
  extractSource,
  webSource,
} from "./templates";
