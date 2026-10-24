---
title: Hello, World
date: 2026-10-19T04:09:28+08:00
tags: ['Essay']
description: Every programmer starts somewhere, and for many, that beginning is a simple program that prints "Hello, World!"
draft: false
outline: true
---

In the world of computing, writing a "Hello, World!" program is a time-honored first step for beginners. There's something satisfying about writing a few lines of code and watching them work for the very first time.

![hello, world](./banner.png)

## Where Did "Hello, World!" Come From?

From what I've been able to find, "Hello, World!" first appeared in Brian Kernighan's internal technical memo _A Tutorial Introduction to the Language B_. Later, as C began to replace B, Kernighan wrote a C version in another internal memo, using the now-familiar `printf("hello, world");`.

In 1978, Kernighan and Dennis Ritchie published _The C Programming Language_. The book's first example program printed "hello, world", helping turn the phrase into one of the most enduring traditions in programming. Since then, it has become a familiar starting point for generations of programmers.

```c
int main() {
    printf("hello, world");
    return 0;
}
```

## What Does "Hello, World!" Mean to Me?

When I first started learning about computers, I wondered why everyone used "Hello, World!" as their first program. Why not "Hello, Java" or "Hello, JavaScript"?

The longer I've spent in this field, the more I've come to appreciate the choice. To me, "Hello, World!" captures two things particularly well:

1. **It's a small but meaningful first step.** Information technology has helped shape the Third Industrial Revolution. Writing and running your first "Hello, World!" program might seem insignificant, but it marks the beginning of a much larger journey. In a small way, you're introducing yourself to the world of programming and becoming part of something that continues to evolve. There's something genuinely exciting about that.
2. **It proves that the basics are in place.** Programming often involves as much work with development environments and toolchains as it does with code itself. If you can successfully run a "Hello, World!" program, you've usually cleared the first hurdle: your basic setup is working. That gives you a solid starting point from which to explore more complex ideas without constantly fighting your environment.

## Why Is This the First Post on My Site?

On the technical side, this post marks an important milestone: the essential pieces of my documentation site are in place, and the site is now up and running. From here, I'll continue to improve it and build on what I've already created.

On a personal level, this post means something more. It's my way of taking the first step toward exploring the wider world and documenting what I see, learn, and experience along the way.

In that sense, this post is more than just an introduction to a website. It's the starting point for everything I hope to share here, which is why it means so much to me.

## Other

### Testing the Site's Markdown Rendering

#### Text Styles

- Plain text
- **Bold text**
- _Italic text_
- **_Bold and italic text_**
- ~~Strikethrough text~~
- ==Highlighted text==
- <u>Underlined text</u>
- **Bold text containing _italic text_**
- _Italic text containing **bold text**_
- **_Bold italic text containing ~~strikethrough text~~_**
- ==Highlight inside bold== is written as **==highlight==**
- **Bold inside highlight** is written as ==**bold**==
- Inline code: `hello, world`
- > Level-one blockquote
  >
  > > Level-two blockquote
  > >
  > > > Level-three blockquote
  > > >
  > > > > Level-four blockquote
- > Blockquotes can also be nested
  >
  > > and combined
  > >
  > > > across
  > > >
  > > > > multiple levels!

#### Links and Images

- Regular link: [GitHub](https://github.com)
- Link with a title: [Visit Baidu](https://www.baidu.com 'Click to visit Baidu')
- Automatic link: <https://www.example.com>
- Email link: <admin@example.com>
- Basic image: ![Placeholder image](/placeholder.svg 'Image title')
- Linked image: [![Click to visit GitHub](/placeholder.svg){width=100}](https://github.com)

#### Lists

- **Unordered list:**
  - Apple
  - Banana
    - Navel orange
    - Blood orange
      - Gannan navel orange
- **Ordered list:**
  1. Step 1: Prepare the ingredients.
  2. Step 2: Wash and prepare the ingredients.
     1. Wash the vegetables.
     2. Chop the vegetables.
  3. Step 3: Cook the ingredients.
- **Task list:**
  - [x] Completed task
  - [ ] Pending task 1
  - [ ] Pending task 2
- **Mixed nested lists:**
  1. First level
     - Unordered sub-item A
     - Unordered sub-item B
  2. Second level
     - [x] Nested task item
     - [ ] Task item mixing ==highlight== with `code`

#### Tables

| Left-Aligned                  | Center-Aligned | Right-Aligned | Default Alignment |
| :---------------------------- | :------------: | ------------: | :---------------- |
| Text content                  |  Text content  |  Text content | Text content      |
| 123456                        |     123456     |        123456 | 123456            |
| A longer piece of sample text |    Centered    | Right-aligned | Default           |
| **Bold text**                 | `Inline code`  |     [Link](#) | Mixed styles      |

#### Code Blocks

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
