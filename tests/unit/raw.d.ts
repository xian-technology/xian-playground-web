// Vite `?raw` imports (test fixtures) resolve to the file's text.
declare module "*?raw" {
  const text: string;
  export default text;
}
