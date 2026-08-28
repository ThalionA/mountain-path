// Re-export so the component is reachable both from the package root and from
// the "./components" subpath the Quartz component loader imports.
// The export name must match the manifest key in package.json (quartz.components).
export { OpenComments, default } from "./components/index.js"
