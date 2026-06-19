// Escape bare `<` and `{` in prose so an MDX renderer downstream doesn't
// choke on the model's free-form output. We split into alternating prose /
// code-region segments so fenced (```) and inline (`) code stay verbatim.

const CODE_REGION = /(```[\s\S]*?```|`[^`\n]*`)/g;

// `<` that does NOT start a valid JSX/HTML construct (letter, $, _, /, !, ?).
// This catches `<1,000`, `< 100`, `<-`, `<=`, etc. while leaving real tags
// (`<details>`, `</details>`, `<!--`) untouched.
const STRAY_LT = /<(?![A-Za-z$_/!?])/g;

// Any bare `{` outside a code region — MDX treats this as the start of a JSX
// expression and errors if it can't close.
const BARE_LBRACE = /\{/g;

export function escapeMdxProse(content: string): string {
  const parts = content.split(CODE_REGION);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        return part;
      }
      return part.replace(STRAY_LT, "&lt;").replace(BARE_LBRACE, "\\{");
    })
    .join("");
}
