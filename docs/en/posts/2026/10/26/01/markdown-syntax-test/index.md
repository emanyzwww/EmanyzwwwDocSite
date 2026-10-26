---
title: Markdown Syntax Test
date: 2026-10-26T10:36:06+08:00
tags: ['Site']
description: 'A syntax cheat sheet you can actually run — the first half exercises plain Markdown (CommonMark and GFM), the second half the layer this site adds on top: highlight, six block directives, the image pipeline and the built-in containers.'
draft: false
outline: true
---

This post _is_ the test: every syntax below is really written out and really rendered.
It comes in two parts:

1. [Basic Markdown Syntax Tests](#_1-basic-markdown-syntax-tests)—native CommonMark / GFM, untouched by this site;
2. [Custom Syntax Tests](#_2-custom-syntax-tests)—the inline highlight, block directives and image pipeline that only exist here.

> One boundary is all you need to remember: **`==highlight==` and a line holding nothing but `:::` are this site's additions; everything else is plain Markdown.**
> Native syntax is never rewritten into something else—a normal link stays a normal link.

## 1. Basic Markdown Syntax Tests

This part uses native syntax only. If something here behaves differently from standard Markdown, it's a bug.

### Paragraphs and Line Breaks

Paragraphs are separated by one or more blank lines. A newline inside a paragraph (a soft break) renders as a space and
does **not** start a new line—counter-intuitive, but you need to know it.

```markdown
This is the first line
and this is the second (they render as one line)
```

Put a blank line after a paragraph and you get a new paragraph.

### Text Styles

- Plain text
- **Bold**
- _Italic_
- **_Bold italic_**
- ~~Strikethrough~~
- ==Highlighted text== ← added by this site; the full boundary rules live in Part 2, under "Inline Highlight"
- <u>Underline</u> ← Markdown has no underline; this is inline HTML
- **Bold text containing _italic text_**
- _Italic text containing **bold text**_
- **_Bold italic text containing ~~strikethrough text~~_**
- ==**Bold inside highlight**==
- **==Highlight inside bold==**
- Inline code `hello, world`
- Backticks inside inline code: `` `code` ``
- Escapes: \*not italic\*, \==not highlighted\==, \`not code\`

### Heading Levels

**Never write a top-level `#` heading** in the body—the page title comes from the frontmatter `title`, and a second one would render two big headings.
What follows is the H4-and-below behaviour (only H2 / H3 make it into the right-hand outline):

#### Level-four heading (H4, not in the outline)

Body text under H4.

##### Level-five heading (H5)

Body text under H5.

###### Level-six heading (H6)

Body text under H6.

### Blockquotes

> Level-one quote

> > Level-two quote

> > > Level-three quote

> > > > Level-four quote

Quotes can hold other blocks, and they nest as deeply as you like:

> A quote can contain whole blocks:
>
> 1. An ordered list
> 2. for instance
>
> ```js
> console.log('a code block inside a quote')
> ```
>
> > And nesting one more level is fine.

### Lists

- **Unordered list:**
  - Apple
  - Banana
    - Navel orange
    - Blood orange
      - Gannan navel orange
- **Ordered list:**
  1. Step 1: prepare the ingredients
  2. Step 2: wash and cut
     1. Wash the vegetables
     2. Chop the vegetables
  3. Step 3: cook
- **Task list (GFM):**
  - [x] A finished task
  - [ ] Pending task 1
  - [ ] Pending task 2
- **Mixed nesting:**
  1. First level
     - Unordered sub-item A
     - Unordered sub-item B
  2. Second level
     - [x] A nested task item
     - [ ] A task item mixing ==highlight== with `code`

An ordered list doesn't have to start at 1 (the one below starts at 3). But note: **it must be its own paragraph**—
glued directly under a line of text, only a list starting with `1.` can interrupt the paragraph, and `3.` would be taken as plain text.
That's why the examples above all start with `-` or `1.`, and this one is preceded by a blank line.

3. Starting at three
4. And counting on

### Tables

| Left-aligned | Center-aligned | Right-aligned | Default |
| :----------- | :------------: | ------------: | :------ |
| Text content |  Text content  |  Text content | Text    |
| 123456       |     123456     |        123456 | 123456  |
| A longer run |    Centered    | Right-aligned | Default |
| **Bold**     | `Inline code`  |     [Link](#) | Mixed   |

To write a literal pipe inside a cell, escape it as `\|`, otherwise it splits the column. On narrow screens the table scrolls horizontally rather than breaking the layout.

### Code

Inline code goes between a pair of backticks: `hello, world`. To show a backtick inside inline code, wrap it in a longer run of backticks: `` `code` ``.

Fenced code blocks need the right language name to get highlighting (`js`, `ts`, `python`, `c`, `bash`, `markdown`, …):

```javascript
// JavaScript syntax highlighting test
function helloWorld() {
  const message = 'Hello, World!'
  console.log(message)
  return true
}
```

```python
# Python syntax highlighting test
def hello_world():
    message = "Hello, World!"
    print(message)
```

Without a language name it still renders, just without highlighting:

```text
A code block with no language tag
```

### Links and Images

- Regular link: [GitHub](https://github.com)
- Link with a title: [Visit Baidu](https://www.baidu.com 'Click to visit Baidu')
- Automatic link: <https://www.example.com>
- Email link: <admin@example.com>
- Internal link (absolute path): [About this site](/en/about/)
- Basic image: ![Placeholder](/placeholder.svg 'Image title')
- Linked image: [![Click to open](/placeholder.svg){width=100}](https://github.com)

> When an image sits **alone in its own paragraph**, this site upgrades it to a `<figure>` that opens full screen.
> That's an addition of ours—see [the image pipeline](#the-image-pipeline). `{width=100}` is VitePress's attrs syntax.

### Horizontal Rules

Three hyphens, three asterisks or three underscores all work (keep blank lines around them, or a `---` turns into a setext H2 for the paragraph above):

---

What `***` gives you:

---

What `___` gives you:

---

## 2. Custom Syntax Tests

This site adds **two shapes** to native Markdown; everything else is a combination of those two or a runtime enhancement:

| Layer  | Shape           | Notes                                                    |
| ------ | --------------- | -------------------------------------------------------- |
| Inline | `==highlight==` | Paragraph-level only, with strict boundary rules (below) |
| Block  | `:::name … :::` | Six directives, the only way to write rich content       |

Two more capabilities need no syntax at all: the **image pipeline** (automatic transcoding, multi-width `srcset`, click-to-zoom)
and the **containers built into VitePress**.

### Inline Highlight `==…==`

Renders as `<mark>`, a pale amber background with its own colours per theme, and it nests freely with other inline syntax:

- Chinese==emphasis==Chinese → highlighted
- word==x==word → highlighted (the `==` sits next to a Chinese character)
- this is ==important== → highlighted (the `==` sits next to a space)
- ==~~strikethrough inside a highlight~~==
- ==a highlight with `inline code`==

Shapes that are never misread (safe to write):

| Shape              | Result                                                             |
| ------------------ | ------------------------------------------------------------------ |
| `a == b`           | A single equals sign, not a marker                                 |
| `if (a==b)`        | Both sides are Latin letters → treated as a comparison, left as is |
| `x==1 && y==2`     | Same; expression-style code won't break                            |
| inline code `a==b` | Backticks consume the content first; `==` never gets parsed        |
| next line is `===` | That's a setext heading, handled by the block layer first          |
| `==unclosed`       | Left as is                                                         |

**The boundary rule in one sentence**: when both sides of a `==` are Latin letters, digits or underscores, it's treated as a comparison operator;
as soon as one side is Chinese, a space or punctuation, it's a highlight.

### Block Directives at a Glance

The shape is always the same, with `:::` alone on its own line to close:

```markdown
:::name arguments
the body is still standard Markdown
:::
```

| Directive    | Purpose            | Usage                                   |
| ------------ | ------------------ | --------------------------------------- |
| `:::github`  | GitHub repo card   | `:::github vuejs/core`                  |
| `:::link`    | External link card | `:::link https://example.com A title`   |
| `:::figure`  | Image with caption | `:::figure caption="A caption"`         |
| `:::quote`   | Quote with source  | `:::quote "The C Programming Language"` |
| `:::columns` | Side-by-side       | `:::columns 2` (split with `---`)       |
| `:::gallery` | Image grid         | `:::gallery` (or `:::gallery 3`)        |

Each of them, live, below.

### `:::github` — GitHub Repository Card

:::github https://github.com/emanyzwww/EmanyzwwwDocSite
:::

At build time it produces **only the repository name and a real link** (zero network requests). The description and star count are
filled in by the browser once you scroll the card into view; if that fails, the link simply stays there—the card never hangs on loading.

### `:::link` — External Link Card

With a custom title (**quote it when the title contains spaces**, otherwise it's split into several positional arguments and the build fails):

:::link https://vitepress.dev "VitePress Documentation"
:::

Without a title the domain is used as a fallback:

:::link https://baidu.com
:::

### `:::figure` — Image with a Caption

The caption comes from the `caption` argument. **Don't** use the image's `title` for this (that's a hover tooltip):

:::figure caption="The caption goes in the caption argument; the image itself still runs through the media pipeline: webp, multi-width srcset, click to zoom"
![A sample image](./figure.png)
:::

> This section and the gallery below reference `figure.png`, `gallery-1.png`, `gallery-2.png` and `gallery-3.png` from the same directory.
> Replacing an image is just **overwriting the same filename**; no Markdown changes needed. A wrong name or a missing file
> fails the build with "image not found" instead of silently producing a broken picture.

### `:::gallery` — Image Grid

Several images written back to back become a _single_ paragraph in Markdown, so a grid has to be wrapped explicitly:

:::gallery 3
![Grid sample one](./gallery-1.png)
![Grid sample two](./gallery-2.png)
![Grid sample three](./gallery-3.png)
:::

- Column count is `2` / `3` / `4`; `2` by default;
- Every image still opens full screen;
- Narrow screens drop to one column, and 3 / 4 columns fall back to 2 at medium widths.

### `:::quote` — Quote with a Source

The source goes right after the directive:

:::quote "The C Programming Language"
The very first example program printed “hello, world”, which is how it became the traditional first lesson in programming.
:::

The named argument `source=` works too, and the body can hold multiple paragraphs, lists or code:

:::quote source="The C Programming Language"

Kernighan and Ritchie did two things in that book:

- they opened with a program that printed “hello, world”
- and turned the phrase into a tradition that has lasted for decades

:::

### `:::columns` — Side-by-Side Columns

Columns are separated by a **`---` on its own line**, and each column is full Markdown:

:::columns 2

**Left column**: the count is `2` or `3`, `2` by default.

- Each column is full Markdown
- Lists, code, images, even nested directives are fine

---

**Right column**: below 704px the layout collapses to a single column—two columns of CJK text leave fewer than 15 characters per line, which is unreadable.

```js
// A code block inside a column works too
const columns = 2
```

:::

### Containers (Built into VitePress)

These four are VitePress's own containers, not something this site invented:

::: tip Tip
This is a tip.
:::

::: warning Warning
This is a warning.
:::

::: danger Danger
This is a danger notice.
:::

::: details Show more
Collapsible blocks work too, and the body is ordinary Markdown.
:::

### The Image Pipeline

Images need no syntax at all; the build does four things automatically:

| Item                   | Behaviour                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| Displayed image        | Transcoded to webp, three `srcset` widths: 336 / 672 / 1008                                              |
| Original               | Shipped untouched, requested only for zoom and download                                                  |
| Image alone in a block | Upgraded to `<figure>`; click to view full screen (page / zoom / download)                               |
| Dimensions             | Read from the file header to prevent layout shift; use `{width=100}` only when you really want to resize |

Inline images are **not** upgraded (that would cut a sentence in half)—two images written on one line both stay inline:

Text ![Image one](/placeholder.svg) with text between ![Image two](/placeholder.svg) them.

Resizing without enabling zoom:

![Placeholder](/placeholder.svg){width=100}

To make an image **non-zoomable** (a purely decorative little icon), add `{data-plain}`:

```markdown
![Decoration](./ornament.png){data-plain}
```

### Inline HTML

With `html: true` in the config, the body accepts raw HTML (use it sparingly):

<div style="padding: 12px 16px; border-radius: 10px; background: var(--bg-surface-alt);">
  This block is HTML written straight into Markdown.
</div>

### Boundaries and Pitfalls

**1. A directive cannot sit directly inside a container**—both use `:::` as the closing fence, so they fight over it.
The fix is to give the outer one more colons than the inner one (short inside, long outside):

```markdown
:::: tip This works
:::github vuejs/core
:::
::::
```

**2. A `:::` inside a fenced code block is content**, not a directive—which is why all the samples above display correctly.

**3. Directives nest**, and the Markdown inside them parses normally:

```markdown
:::quote "Some book"

:::github vuejs/core
:::

:::
```

**4. Mistakes fail the build**, with the file and line number, so you never discover them in production:

- `Unknown directive: :::gihub` (it lists the available directives and guesses what you meant)
- `Directive :::github is not closed` (a missing closing `:::`)
- `:::github is missing a repository name` (no argument)

**5. A bare GitHub repository link no longer turns into a card**—it's just a normal link now.
Write `:::github owner/repo` when you want the card; `pnpm check` reports leftovers in the old style.

### Self-Check List

After editing this page, walk through these in order:

- [ ] `pnpm dev` renders every single item on this page
- [ ] Images open full screen and the original downloads (`public/` images are not zoomable, by design)
- [ ] The cards show a repository name and a real link (no empty box, even offline)
- [ ] `pnpm build` finishes without errors
- [ ] `pnpm check` reports no new warnings
